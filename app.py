import json
import os
from dataclasses import dataclass
from typing import List, Optional

from flask import Flask, redirect, render_template, request, session, url_for
from dotenv import load_dotenv
from spotipy import Spotify
from spotipy.cache_handler import MemoryCacheHandler
from spotipy.oauth2 import SpotifyOAuth
from ytmusicapi import YTMusic


@dataclass
class TransferResult:
    title: str
    artist: str
    album: str
    youtube_video_id: Optional[str]
    status: str


class SpotifyExporter:
    def __init__(self, spotify_client: Spotify):
        self.spotify = spotify_client

    def fetch_liked_tracks(self, limit: int = 100) -> List[dict]:
        offset = 0
        tracks: List[dict] = []
        while True:
            response = self.spotify.current_user_saved_tracks(limit=limit, offset=offset)
            items = response.get("items", [])
            tracks.extend(items)
            if len(items) < limit:
                break
            offset += limit
        return tracks


class YouTubeImporter:
    def __init__(self, headers_json: str):
        try:
            headers = json.loads(headers_json)
        except json.JSONDecodeError as exc:
            raise ValueError("YTMUSIC_COOKIE must contain a valid JSON string of headers") from exc
        self.client = YTMusic(headers)

    def ensure_playlist(self, name: str) -> str:
        playlists = self.client.get_library_playlists()
        for playlist in playlists:
            if playlist.get("title") == name:
                return playlist["playlistId"]
        return self.client.create_playlist(name, "Imported from Spotify Favorites")

    def search_and_add(self, playlist_id: str, title: str, artist: str) -> Optional[str]:
        query = f"{title} {artist}"
        search_results = self.client.search(query, filter="songs")
        if not search_results:
            return None
        best_match = search_results[0]
        video_id = best_match.get("videoId")
        if not video_id:
            return None
        self.client.add_playlist_items(playlist_id, [video_id])
        return video_id


load_dotenv()


app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "development-secret")


def _spotify_oauth() -> SpotifyOAuth:
    redirect_uri = os.environ.get("SPOTIFY_REDIRECT_URI", "https://localhost:5000/callback")
    scope = "user-library-read"
    cache_handler = MemoryCacheHandler(token_info=session.get("spotify_token"))
    return SpotifyOAuth(
        client_id=os.environ.get("SPOTIFY_CLIENT_ID"),
        client_secret=os.environ.get("SPOTIFY_CLIENT_SECRET"),
        scope=scope,
        redirect_uri=redirect_uri,
        show_dialog=True,
        cache_handler=cache_handler,
    )


@app.route("/")
def index():
    logged_in = "spotify_token" in session
    return render_template("index.html", logged_in=logged_in)


@app.route("/login")
def login():
    auth_manager = _spotify_oauth()
    auth_url = auth_manager.get_authorize_url()
    session["oauth_state"] = request.args.get("state")
    return redirect(auth_url)


@app.route("/callback")
def callback():
    auth_manager = _spotify_oauth()
    code = request.args.get("code")
    if not code:
        return render_template("error.html", message="Spotify authorization failed."), 400
    token_info = auth_manager.get_access_token(code)
    session["spotify_token"] = token_info
    return redirect(url_for("transfer"))


def _get_spotify_client() -> Spotify:
    token_info = session.get("spotify_token")
    if not token_info:
        raise RuntimeError("Spotify token missing")
    auth_manager = _spotify_oauth()
    auth_manager.cache_handler.save_token_to_cache(token_info)
    if auth_manager.is_token_expired(token_info):
        token_info = auth_manager.refresh_access_token(token_info["refresh_token"])
        session["spotify_token"] = token_info
        auth_manager.cache_handler.save_token_to_cache(token_info)
    return Spotify(auth_manager=auth_manager)


@app.route("/transfer")
def transfer():
    token_info = session.get("spotify_token")
    if not token_info:
        return redirect(url_for("index"))
    return render_template("transfer.html")


@app.route("/run-transfer", methods=["POST"])
def run_transfer():
    token_info = session.get("spotify_token")
    if not token_info:
        return redirect(url_for("index"))

    headers_json = os.environ.get("YTMUSIC_COOKIE")
    if not headers_json:
        return render_template(
            "error.html",
            message="Missing YTMUSIC_COOKIE environment variable containing exported YouTube Music headers.",
        ), 500

    spotify_client = _get_spotify_client()
    spotify_exporter = SpotifyExporter(spotify_client)
    try:
        youtube_importer = YouTubeImporter(headers_json)
    except ValueError as exc:
        return render_template("error.html", message=str(exc)), 500

    spotify_tracks = spotify_exporter.fetch_liked_tracks(limit=50)
    playlist_id = youtube_importer.ensure_playlist("Spotify Favorites Imports")

    transfer_results: List[TransferResult] = []
    for item in spotify_tracks:
        track = item.get("track") or {}
        title = track.get("name", "Unknown Title")
        artists = ", ".join(artist["name"] for artist in track.get("artists", []))
        album = track.get("album", {}).get("name", "")

        video_id = youtube_importer.search_and_add(playlist_id, title, artists)
        status = "Imported" if video_id else "Not Found"
        transfer_results.append(
            TransferResult(
                title=title,
                artist=artists,
                album=album,
                youtube_video_id=video_id,
                status=status,
            )
        )

    return render_template(
        "results.html",
        results=transfer_results,
        playlist_id=playlist_id,
        total=len(transfer_results),
        imported=sum(1 for result in transfer_results if result.status == "Imported"),
    )


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True, ssl_context="adhoc")
