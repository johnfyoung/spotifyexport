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

1. Create a Spotify application at <https://developer.spotify.com/dashboard> and set the redirect URI to `http://localhost:5000/callback`.
2. Export your YouTube Music request headers using the `ytmusicapi` quick start instructions.
3. Copy `.env.example` to `.env` and populate the values:

```bash
cp .env.example .env
```

4. Install dependencies and run the server with [Pipenv](https://pipenv.pypa.io/):

```bash
pipenv install -r requirements.txt
pipenv run flask --app app run --debug
```

The app will be available at <http://localhost:5000>.

## Usage

1. Click **Connect Spotify** and authorize the application to read your saved tracks.
2. After authentication, start the transfer to create/update the YouTube Music playlist.
3. Review the results table for any tracks that could not be matched.

> **Note:** The YouTube Music import relies on public search results. Some tracks may not have an exact match or may require manual review.

## Development

- The Flask app auto reloads when run via `flask --app app run --debug`.
- Templates live in `templates/` and static assets in `static/`.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
