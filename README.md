# LSF-Recognition

## Run locally

To run the platform with the MediaPipe-DTW recogniser, start its local backend:

```bash
cd ~/LSF-Recognition/Sign-Language-Recognition--MediaPipe-DTW
source .venv/bin/activate
python -m pip install -r ../platform/requirements.txt
python ../platform/server.py
```

Then open <http://localhost:8000>. The first startup may take time while reference-video landmarks are prepared. The reference videos and MediaPipe model file are local data and must also be available on a fresh clone; see [the DTW project README](Sign-Language-Recognition--MediaPipe-DTW/README.md).
