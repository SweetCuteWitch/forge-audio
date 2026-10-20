# forge-audio

A single-page piano roll for `forge/tune@1` chip tracks from the Forge `tune` CLI.

Open `index.html` in a browser — no build, no server, no dependencies.

- edit notes in a piano roll or as tracker rows, play them back with the same
  NES-style synth `tune render` uses;
- open `.tune.json` or `.mid`; save `.tune.json`, `.mid`, `.wav`;
- `skyroad.tune.json` is the demo track embedded in the page.

## Studio tracks

A track with `"profile": "studio"` plays through Forge's own renderer, the same
code as `tune render`: `forge-sound-worker.js` runs it in a Web Worker. On Play
the page renders only the channels that changed since the last Play, then the
master; muting or soloing re-mixes from the cached channels. The channel form
offers the sample library's instruments and Forge's synths, and a dynamics
slider for sampled ones. Studio playback needs the page served over HTTP — a
module worker does not start from `file://`.

Samples come from `samples/` next to the page when it runs on `localhost` or
`127.0.0.1`, and from
`https://raw.githubusercontent.com/SweetCuteWitch/forge-audio/main/samples/`
everywhere else (Vercel does not deploy `samples/`). Only `catalog.json`, the
`instrument.json` of each instrument a track uses and the zone files its notes
need are downloaded; they are checked against their checksums and cached by the
browser.

`forge-sound-worker.js` is built, never edited: run `npm run page:bundle` in
Forge, which writes it here; the footer of the side panel shows its version.
