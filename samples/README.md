# The Forge sample library

Multi-sampled instruments for the Forge studio (`npm run tune` in the Forge
repository): real recordings of pianos, guitars, organs, voices, winds and
drums, played by the studio's sampled voice next to its synthesizers.

## Layout

```
samples/
  LICENSES.md              every instrument's source, licence, author, attribution
  <id>/
    instrument.json        manifest, format "forge/instrument@1"
    zones/n<root>-v<layer>-r<rr>.flac
```

- Audio is FLAC, 44.1 kHz, 16-bit, mono unless the instrument is naturally
  stereo (a piano may be).
- `instrument.json` lists every zone: its root note, key and velocity range,
  round-robin index, loop points in frames (`loopEnd` exclusive), and the
  sha256 and size of its file. Forge checks both when it loads a zone.
- An `<id>` never equals a Forge synth instrument id.

## Where it comes from

Nothing here is edited by hand. Forge's importer (`npm run samples -- import
<recipe>` in Forge, recipes in `tools/samples/recipes/`) reads a free SFZ
library, thins it, resamples, trims and normalises the zones, writes this
folder, and prints per-zone metrics. `npm run samples -- licences` regenerates
`LICENSES.md`.

## Licences

Only CC0, CC-BY (any version) and MIT recordings are accepted; the importer
refuses anything else, and each source's own licence text is read before it is
imported. CC-BY instruments carry an attribution line in their manifest and in
`LICENSES.md`: credit it when you publish work that uses them.

## Hosting

Forge reads the library from a local clone (`../forge-audio/samples`, or
`FORGE_SAMPLES`), else downloads files from this repository's raw GitHub URLs.
The site deployment does not carry it yet (`.vercelignore`).
