# Spotify Favorites Exporter

This project provides a lightweight Flask web app that authenticates with Spotify, exports your liked tracks, and creates a matching playlist in YouTube Music.

## Features

- OAuth login with Spotify
- Fetches your saved tracks (liked songs)
- Uses [ytmusicapi](https://ytmusicapi.readthedocs.io/) to search for matching songs
- Creates or reuses a "Spotify Favorites Imports" playlist on YouTube Music and populates it with matches
- Simple responsive interface for running the transfer and viewing results

## Requirements

- Python 3.10+
- Spotify developer credentials
- YouTube Music request headers exported from your browser session (see ytmusicapi docs)

## Setup

1. Create a Spotify application at <https://developer.spotify.com/dashboard> and set the redirect URI to `https://localhost:5000/callback`.
2. Generate YouTube Music authentication data using the [`ytmusicapi` setup guide](https://ytmusicapi.readthedocs.io/en/stable/setup.html) (see "Obtaining YouTube Music credentials" below).
3. Copy `.env.example` to `.env` and populate the values:

```bash
cp .env.example .env
```

4. Install dependencies and run the server with [Pipenv](https://pipenv.pypa.io/):

```bash
pipenv install -r requirements.txt
pipenv run flask --app app run --debug --cert=adhoc
```

The app will be available at <https://localhost:5000>. Your browser will prompt you to trust the self-signed certificate the first time you visit.

## Usage

1. Click **Connect Spotify** and authorize the application to read your saved tracks.
2. After authentication, start the transfer to create/update the YouTube Music playlist.
3. Review the results table for any tracks that could not be matched.

> **Note:** The YouTube Music import relies on public search results. Some tracks may not have an exact match or may require manual review.

### Obtaining YouTube Music credentials

`ytmusicapi` needs authenticated information from your YouTube Music account to manage playlists. The setup guide from the official docs outlines two approaches—OAuth or manual headers. This project supports both, and the steps below call out the exact permissions you must grant.

#### Option A: OAuth (recommended)

1. Make sure the dependencies are installed (`pipenv install -r requirements.txt`).
2. Run the OAuth helper to launch a browser login flow:

   ```bash
   pipenv run ytmusicapi oauth
   ```

3. When prompted, sign in with the Google account tied to your YouTube Music subscription and allow the requested `https://www.googleapis.com/auth/youtube` scope. This "Manage your YouTube account" permission lets the importer create and modify playlists on your behalf.
4. After you complete the prompts, the CLI stores an `oauth.json` file in the current directory (or prints the path if it already exists).
5. Set `YTMUSIC_OAUTH_FILE` in your `.env` file to the full path of that `oauth.json` file.

#### Option B: Manual headers

If you prefer the legacy method, follow the "Manual authentication" instructions in the docs to export request headers from <https://music.youtube.com>. At minimum you need the `Authorization`, `Cookie`, `X-Goog-AuthUser`, `X-Goog-Visitor-Id`, and `User-Agent` headers. Copy the resulting JSON into the `YTMUSIC_COOKIE` entry in `.env`.

Steps in Chrome/Edge:

1. Visit <https://music.youtube.com> while logged into the account you want to use.
2. Open Developer Tools (F12) and switch to the **Network** tab.
3. Refresh the page and select any request whose path starts with `browse`.
4. In the **Headers** panel choose **Copy** → **Copy request headers** and paste them into a text editor.
5. Convert the headers into JSON (a single object with the header names as keys) and store them in a file. Paste that JSON into `YTMUSIC_COOKIE`.

> **Security tip:** Treat the OAuth file or header JSON like credentials. Keep them private and regenerate them if you suspect they were exposed.

## Development

- The Flask app auto reloads when run via `flask --app app run --debug`.
- Templates live in `templates/` and static assets in `static/`.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
