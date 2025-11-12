import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import querystring from 'querystring';
import axios from 'axios';
import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import expressLayouts from 'express-ejs-layouts';
import selfsigned from 'selfsigned';
import { google } from 'googleapis';
import SpotifyWebApi from 'spotify-web-api-node';
import crypto from 'node:crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const USE_HTTPS = process.env.USE_HTTPS !== 'false';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me';

function requireSecureRedirect(service, rawUri, fallback) {
  const uri = rawUri || fallback;
  if (!uri) {
    throw new Error(`${service} redirect URI is not configured.`);
  }
  let parsed;
  try {
    parsed = new URL(uri);
  } catch (err) {
    throw new Error(`${service} redirect URI is invalid: ${uri}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `${service} redirect URI must use https:// to satisfy OAuth requirements. Received: ${uri}`
    );
  }
  return uri;
}

const SPOTIFY_REDIRECT_URI = requireSecureRedirect(
  'Spotify',
  process.env.SPOTIFY_REDIRECT_URI,
  `https://localhost:${PORT}/auth/spotify/callback`
);
const GOOGLE_REDIRECT_URI = requireSecureRedirect(
  'Google',
  process.env.GOOGLE_REDIRECT_URI,
  `https://localhost:${PORT}/auth/google/callback`
);

const SPOTIFY_SCOPES = ['user-library-read', 'playlist-read-private', 'playlist-read-collaborative'];
const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

app.set('views', path.join(__dirname, 'templates'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layout');
app.use(express.static(path.join(__dirname, 'static')));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: USE_HTTPS,
      sameSite: 'lax',
    },
  })
);

app.use((req, res, next) => {
  res.locals.spotifyConnected = Boolean(req.session?.spotify);
  res.locals.youtubeConnected = Boolean(req.session?.youtube);
  res.locals.lastResults = req.session?.results ?? null;
  next();
});

function buildSpotifyClient(tokens) {
  const client = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: SPOTIFY_REDIRECT_URI,
  });
  if (tokens) {
    client.setAccessToken(tokens.accessToken);
    client.setRefreshToken(tokens.refreshToken);
  }
  return client;
}

function spotifyAuthUrl(state) {
  const params = querystring.stringify({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: SPOTIFY_SCOPES.join(' '),
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

function googleOAuthClient(sessionTokens) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
  if (sessionTokens) {
    client.setCredentials(sessionTokens);
  }
  return client;
}

function googleAuthUrl(state) {
  const client = googleOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: YOUTUBE_SCOPES,
    prompt: 'consent',
    state,
  });
}

function describeGoogleError(error, fallback = 'Google API request failed.') {
  if (!error) {
    return fallback;
  }

  const candidateMessages = [
    error.response?.data?.error?.message,
    Array.isArray(error.errors) && error.errors.length ? error.errors[0]?.message : null,
    typeof error.message === 'string' ? error.message : null,
  ].filter((message) => typeof message === 'string' && message.trim().length);

  if (!candidateMessages.length) {
    return fallback;
  }

  const message = candidateMessages[0];
  const lowered = message.toLowerCase();
  if (
    lowered.includes('insufficient permission') ||
    lowered.includes('not properly authorized') ||
    lowered.includes('invalid authentication credentials')
  ) {
    return `${message}. Reconnect your Google account and confirm the YouTube Data API v3 is enabled for your project.`;
  }
  return message;
}

async function refreshSpotifyToken(req) {
  const tokens = req.session.spotify;
  if (!tokens?.refreshToken) {
    throw new Error('Missing Spotify refresh token.');
  }
  const client = buildSpotifyClient(tokens);
  const result = await client.refreshAccessToken();
  const accessToken = result.body['access_token'];
  req.session.spotify.accessToken = accessToken;
  return accessToken;
}

async function spotifyRequest(url, accessToken, params) {
  const { data } = await axios.get(url, {
    params,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return data;
}

async function fetchSpotifyPlaylists(accessToken) {
  const playlists = [];
  let nextUrl = 'https://api.spotify.com/v1/me/playlists';
  while (nextUrl) {
    const data = await spotifyRequest(nextUrl, accessToken, { limit: 50 });
    if (Array.isArray(data.items)) {
      data.items.forEach((playlist) => {
        playlists.push({
          id: playlist.id,
          name: playlist.name,
          description: playlist.description,
          images: playlist.images ?? [],
          trackCount: playlist.tracks?.total ?? 0,
          owner: playlist.owner?.display_name || playlist.owner?.id,
        });
      });
    }
    nextUrl = data.next;
  }
  return playlists;
}

function normalizeSpotifyTrack(item) {
  if (!item?.track || item.is_local) {
    return null;
  }
  const track = item.track;
  return {
    id: track.id,
    name: track.name,
    artists: track.artists?.map((artist) => artist.name) ?? [],
    album: track.album?.name,
  };
}

async function fetchSpotifyPlaylist(accessToken, playlistId) {
  const playlistUrl = `https://api.spotify.com/v1/playlists/${playlistId}`;
  const data = await spotifyRequest(playlistUrl, accessToken, {
    fields:
      'id,name,description,owner(display_name,id),tracks(items(track(name,id,artists(name),album(name)),is_local),next,total)',
  });

  const playlist = {
    id: data.id,
    name: data.name,
    description: data.description,
    owner: data.owner?.display_name || data.owner?.id,
    trackCount: data.tracks?.total ?? 0,
    tracks: [],
  };

  if (Array.isArray(data.tracks?.items)) {
    data.tracks.items.forEach((item) => {
      const normalized = normalizeSpotifyTrack(item);
      if (normalized) {
        playlist.tracks.push(normalized);
      }
    });
  }

  let nextUrl = data.tracks?.next;
  while (nextUrl) {
    const nextData = await spotifyRequest(nextUrl, accessToken);
    if (Array.isArray(nextData.items)) {
      nextData.items.forEach((item) => {
        const normalized = normalizeSpotifyTrack(item);
        if (normalized) {
          playlist.tracks.push(normalized);
        }
      });
    }
    nextUrl = nextData.next;
  }

  return playlist;
}

async function ensureFreshSpotifyToken(req) {
  const tokenInfo = req.session.spotify;
  if (!tokenInfo) {
    throw new Error('Spotify session is missing.');
  }
  const expiresAt = tokenInfo.expiresAt ?? 0;
  if (Date.now() >= expiresAt) {
    const accessToken = await refreshSpotifyToken(req);
    const now = Date.now();
    req.session.spotify.expiresAt = now + 50 * 60 * 1000;
    return accessToken;
  }
  return tokenInfo.accessToken;
}

async function ensureYoutubeAuth(req) {
  if (!req.session.youtube) {
    throw new Error('Google session is missing.');
  }
  const client = googleOAuthClient(req.session.youtube);
  client.on('tokens', (tokens) => {
    req.session.youtube = {
      ...req.session.youtube,
      ...tokens,
    };
    req.session.save(() => {});
  });
  try {
    const { token } = await client.getAccessToken();
    if (!token) {
      throw new Error('Unable to obtain Google access token.');
    }
  } catch (err) {
    throw new Error(describeGoogleError(err, 'Google authorization failed. Please reconnect to continue.'));
  }
  const youtube = google.youtube({ version: 'v3', auth: client });
  return { client, youtube };
}

async function createPlaylist(youtube, title, description) {
  const { data } = await youtube.playlists.insert({
    part: 'snippet,status',
    requestBody: {
      snippet: {
        title,
        description,
      },
      status: {
        privacyStatus: 'private',
      },
    },
  });
  return data.id;
}

async function searchYoutubeTrack(youtube, track) {
  const query = `${track.name} ${track.artists.join(' ')}`;
  const { data } = await youtube.search.list({
    part: 'id,snippet',
    q: query,
    type: 'video',
    videoCategoryId: '10',
    maxResults: 5,
  });
  if (!data.items?.length) {
    return null;
  }
  const match = data.items.find((item) => item.id?.videoId);
  return match ? match.id.videoId : null;
}

async function addTrackToPlaylist(youtube, playlistId, videoId) {
  await youtube.playlistItems.insert({
    part: 'snippet',
    requestBody: {
      snippet: {
        playlistId,
        resourceId: {
          kind: 'youtube#video',
          videoId,
        },
      },
    },
  });
}

app.get('/', async (req, res) => {
  let playlists = [];
  let playlistError = null;

  if (req.session.spotify) {
    try {
      const accessToken = await ensureFreshSpotifyToken(req);
      playlists = await fetchSpotifyPlaylists(accessToken);
    } catch (err) {
      console.error('Failed to load Spotify playlists', err.message);
      playlistError = err.message || 'Failed to load Spotify playlists.';
    }
  }

  res.render('index', {
    title: 'Spotify → YouTube Music',
    playlists,
    playlistError,
  });
});

app.get('/connect/spotify', (req, res) => {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    return res.render('error', {
      title: 'Configuration required',
      message: 'Spotify client ID and secret must be configured in the environment.',
    });
  }
  const state = cryptoRandomString();
  req.session.spotifyState = state;
  res.redirect(spotifyAuthUrl(state));
});

app.get('/auth/spotify/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.render('error', { title: 'Spotify error', message: `Spotify authorization failed: ${error}` });
  }
  if (!state || state !== req.session.spotifyState) {
    return res.render('error', { title: 'Spotify error', message: 'Spotify state mismatch. Please try again.' });
  }
  if (!code) {
    return res.render('error', { title: 'Spotify error', message: 'Missing Spotify authorization code.' });
  }
  try {
    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      querystring.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
        },
      }
    );
    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    req.session.spotify = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + (expires_in - 60) * 1000,
    };
    delete req.session.spotifyState;
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Spotify error', message: 'Failed to exchange Spotify authorization code.' });
  }
});

app.get('/connect/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.render('error', {
      title: 'Configuration required',
      message: 'Google client ID and secret must be configured in the environment.',
    });
  }
  const state = cryptoRandomString();
  req.session.googleState = state;
  res.redirect(googleAuthUrl(state));
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.render('error', { title: 'Google error', message: `Google authorization failed: ${error}` });
  }
  if (!state || state !== req.session.googleState) {
    return res.render('error', { title: 'Google error', message: 'Google state mismatch. Please try again.' });
  }
  if (!code) {
    return res.render('error', { title: 'Google error', message: 'Missing Google authorization code.' });
  }
  try {
    const client = googleOAuthClient();
    const { tokens } = await client.getToken(code);
    req.session.youtube = tokens;
    delete req.session.googleState;
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Google error', message: 'Failed to exchange Google authorization code.' });
  }
});

app.post('/transfer', async (req, res) => {
  try {
    if (!req.session.spotify || !req.session.youtube) {
      return res.render('error', {
        title: 'Authorization required',
        message: 'Please connect both Spotify and Google before running the transfer.',
      });
    }

    let selected = req.body.playlistIds;
    if (!selected) {
      return res.render('error', {
        title: 'No playlists selected',
        message: 'Choose at least one Spotify playlist to transfer.',
      });
    }

    if (!Array.isArray(selected)) {
      selected = [selected];
    }

    const accessToken = await ensureFreshSpotifyToken(req);
    const { youtube } = await ensureYoutubeAuth(req);

    const playlistResults = [];

    for (const playlistId of selected) {
      try {
        const playlist = await fetchSpotifyPlaylist(accessToken, playlistId);
        if (!playlist.tracks.length) {
          playlistResults.push({
            source: playlist,
            items: [],
            imported: 0,
            playlistId: null,
            playlistTitle: playlist.name,
            totalTracks: 0,
            status: 'No tracks found in playlist',
            outcome: 'warning',
          });
          continue;
        }

        const playlistTitle = `Spotify · ${playlist.name}`;
        const descriptionLines = [
          `Imported from Spotify playlist "${playlist.name}"`,
          playlist.description ? playlist.description : null,
          `Owner: ${playlist.owner || 'Unknown'}`,
        ].filter(Boolean);
        const playlistDescription = `${descriptionLines.join('\n')}`;
        const youtubePlaylistId = await createPlaylist(youtube, playlistTitle, playlistDescription);

        const trackResults = [];
        for (const track of playlist.tracks) {
          try {
            const videoId = await searchYoutubeTrack(youtube, track);
            if (!videoId) {
              trackResults.push({
                track,
                status: 'No YouTube match found',
                outcome: 'warning',
              });
              continue;
            }
            await addTrackToPlaylist(youtube, youtubePlaylistId, videoId);
            trackResults.push({ track, status: 'Added to playlist', outcome: 'success' });
          } catch (trackErr) {
            const errorMessage = describeGoogleError(trackErr, 'Failed to import');
            console.error('Failed to import track', track.name, errorMessage);
            trackResults.push({
              track,
              status: errorMessage,
              outcome: 'error',
            });
          }
        }

        playlistResults.push({
          source: playlist,
          playlistId: youtubePlaylistId,
          playlistTitle,
          totalTracks: playlist.tracks.length,
          imported: trackResults.filter((r) => r.outcome === 'success').length,
          items: trackResults,
          outcome: 'success',
        });
      } catch (playlistErr) {
        const playlistErrorMessage = describeGoogleError(
          playlistErr,
          'Unexpected playlist transfer failure.'
        );
        console.error('Failed to transfer playlist', playlistId, playlistErrorMessage);
        playlistResults.push({
          source: { id: playlistId },
          playlistId: null,
          playlistTitle: 'Unknown playlist',
          totalTracks: 0,
          imported: 0,
          items: [],
          outcome: 'error',
          status: playlistErrorMessage,
        });
      }
    }

    req.session.results = {
      generatedAt: new Date().toISOString(),
      playlists: playlistResults,
    };

    res.redirect('/results');
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Transfer failed', message: err.message || 'Unexpected transfer failure.' });
  }
});

app.get('/results', (req, res) => {
  const lastResults = req.session.results;
  if (!lastResults) {
    return res.redirect('/');
  }
  res.render('results', {
    title: 'Transfer results',
    lastResults,
  });
});

app.post('/reset', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
});

function cryptoRandomString() {
  return crypto.randomBytes(16).toString('hex');
}

function startServer() {
  if (USE_HTTPS) {
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = selfsigned.generate(attrs, { days: 30, keySize: 2048 });
    https
      .createServer({ key: pems.private, cert: pems.cert }, app)
      .listen(PORT, () => {
        console.log(`HTTPS server listening on https://localhost:${PORT}`);
      });
  } else {
    http.createServer(app).listen(PORT, () => {
      console.log(`HTTP server listening on http://localhost:${PORT}`);
    });
  }
}

startServer();
