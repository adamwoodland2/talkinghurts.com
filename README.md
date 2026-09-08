# Talking Hurts

**[talkinghurts.com](https://talkinghurts.com/)** - a free communication aid for when your
voice is gone or every word costs too much: laryngitis, a strained voice, throat or thyroid
surgery recovery, radiotherapy, mouth pain.

Build a sentence from one-tap phrase completions and predicted next words; your device
speaks it aloud with a natural neural voice, or shows it in giant text for the person
opposite you.

## How it works

- **Context tabs** (Help, Out, Home, Shop, Cafe, Medical) each carry situation-appropriate
  seed phrases; the red Help tab is pinned first. Saved places can switch the context
  automatically when you arrive (checked in the foreground only).
- **It learns**: every sentence you speak becomes a one-tap suggestion next time, weighted
  by use, per context - a simple sentence-frequency model with a bigram fallback, entirely
  in local storage.
- **Voices**: your device's built-in speech out of the box; optionally a natural
  [Piper](https://github.com/rhasspy/piper) neural voice (~60 MB one-time download from
  Hugging Face), synthesised on-device with a self-hosted
  [vits-web](https://github.com/diffusionstudio/vits-web) + ONNX Runtime stack. Synthesised
  clips are cached; Help-tab phrases are pre-synthesised so emergencies never wait.
- **Private by design**: no server, no accounts, no analytics beyond standard web logs.
  The model, history, settings and places never leave the device. Backups are files you
  export yourself - imports merge, so learning from phone and PC combines.
- **Installable PWA**: works fully offline, portrait and landscape.

## Running locally

Any static server works (ES modules need http):

```
python -m http.server 8000
```

## Licences

App: MIT (see [LICENSE](LICENSE)). Bundled: vits-web, @diffusionstudio/piper-wasm and
onnxruntime-web (all MIT). Voice models are downloaded by the user from Hugging Face and
carry their own licences (OpenSLR 83 CC-BY-SA 4.0; Edinburgh DataShare CC-BY 4.0; Jenny
(Dioco) custom attribution licence; Mycroft mimic3 apope).

Not a regulated medical device and not a substitute for professional speech therapy or AAC
assessment.
