# Spotify Favorites Exporter

This project provides a Node.js web app that signs into Spotify and Google, exports your liked Spotify tracks, and creates a private YouTube playlist with the closest matches it can find.

## Features

- Spotify OAuth flow to read your saved tracks
- Google OAuth flow with the YouTube Data API to create private playlists
- Full transfer workflow with progress tracking and a results table
- HTTPS-by-default local development server that satisfies Spotify's redirect requirements
- Modern UI with responsive styling

## Requirements

- Node.js 18+
- A Spotify application with a redirect URI configured for `https://localhost:5000/auth/spotify/callback`
- A Google Cloud project with a YouTube Data API OAuth client (see below)

## Setup

1. **Create Spotify credentials**
   - Visit <https://developer.spotify.com/dashboard> and create an application.
   - Add `https://localhost:5000/auth/spotify/callback` to the redirect URIs.
   - Copy the client ID and client secret.
   - The development server refuses to start if the redirect URI is not HTTPS, because Spotify will return `INVALID_CLIENT: Insecure redirect URI` otherwise.

2. **Create Google OAuth credentials**
   - Open <https://console.cloud.google.com/apis/credentials> in the Google Cloud project you want to use.
   - Enable the **YouTube Data API v3** for the project.
   - Create an **OAuth client ID** of type **Web application** with the authorized redirect URI `https://localhost:5000/auth/google/callback`.
   - Copy the client ID and client secret.

3. **Configure environment variables**
   - Copy `.env.example` to `.env` and fill in the values from the steps above.

     ```bash
     cp .env.example .env
     ```

4. **Install dependencies and start the dev server**

   ```bash
   npm install
   npm run dev
   ```

   The development server automatically provisions a self-signed certificate and listens on `https://localhost:5000`. The first time you open it your browser will warn about the certificate—proceed to trust it so Spotify and Google can redirect back to your machine.

## Usage

1. Navigate to <https://localhost:5000>.
2. Click **Connect Spotify** and approve the request to read your saved tracks.
3. Click **Connect Google** and grant the `https://www.googleapis.com/auth/youtube` scope so the app can create playlists.
4. Use **Run transfer** in the header to create a new private YouTube playlist populated with your liked Spotify tracks.
5. Review the results table for any songs that could not be matched via public YouTube search.

> **Privacy note:** Access and refresh tokens are only stored in your encrypted session while the server is running. Clear your session with the **Reset session** button after each transfer if you are finished.

## Environment variables

| Variable | Description |
| --- | --- |
| `PORT` | Optional port override (defaults to `5000`). |
| `USE_HTTPS` | Set to `false` to fall back to HTTP. Leave enabled to satisfy Spotify redirect rules. |
| `SESSION_SECRET` | Secret used to sign the session cookie. Change this in production. |
| `SPOTIFY_CLIENT_ID` | Spotify application client ID. |
| `SPOTIFY_CLIENT_SECRET` | Spotify application client secret. |
| `SPOTIFY_REDIRECT_URI` | Override for the Spotify redirect URI (defaults to `https://localhost:5000/auth/spotify/callback`). Must use `https://`. |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. |
| `GOOGLE_REDIRECT_URI` | Override for the Google redirect URI (defaults to `https://localhost:5000/auth/google/callback`). Must use `https://`. |

## Development tips

- Templates live in `templates/` and use [EJS](https://ejs.co/) with a shared layout.
- Static assets (CSS, images) live in `static/`.
- The YouTube Data API has quota limits; if you plan to run large migrations, request higher quota in the Google Cloud console.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
