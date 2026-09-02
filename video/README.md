# Video working folder

The raw screen recordings, the narration and the rendered output all live
here and are all gitignored; only this file and `clips.txt` are tracked,
because the manifest records the edit decisions.

1. Record the six clips (see `docs/webmcp/video-narration.md`) and drop
   them in this folder.
2. List them in `clips.txt` in playing order, with trims and speed as
   needed. The format is documented in `scripts/stitch-video.sh`.
3. From the repository root, run `scripts/stitch-video.sh` for a silent
   cut, and watch `video/final.mp4`. Tighten the trims and repeat.
4. Record the narration against the locked cut, save it here, then run
   `scripts/stitch-video.sh video video/narration.m4a` for the final file.
