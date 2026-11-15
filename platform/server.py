"""Local web server that connects Learn LSF to the MediaPipe-DTW recogniser."""

from __future__ import annotations

import os
import math
import random
import sys
import tempfile
import threading
import unicodedata
import uuid
from pathlib import Path
from urllib.parse import quote

import cv2
import numpy as np
from flask import Flask, jsonify, request, send_from_directory


PLATFORM_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PLATFORM_DIR.parent
RECOGNISER_DIR = PROJECT_ROOT / "Sign-Language-Recognition--MediaPipe-DTW"
VIDEO_DIR = RECOGNISER_DIR / "data" / "videos"
MAX_CLIP_BYTES = 40 * 1024 * 1024
MAX_UPLOAD_BYTES = 110 * 1024 * 1024
MAX_CLIP_SECONDS = 12
SAMPLED_FRAME_COUNT = 50

sys.path.insert(0, str(RECOGNISER_DIR))

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

recogniser_state = {"status": "not started", "error": None, "reference_signs": None}
def load_recogniser() -> None:
    """Load the local reference videos/cache once in the background."""
    recogniser_state["status"] = "loading"
    try:
        os.chdir(RECOGNISER_DIR)
        from utils.dataset_utils import load_dataset, load_reference_signs

        videos = load_dataset()
        if not videos:
            raise RuntimeError(
                "Aucune vidéo de référence trouvée dans data/videos. "
                "Ajoute/importes les vidéos LSF puis relance le serveur."
            )
        references = load_reference_signs(videos)
        if references.empty:
            raise RuntimeError("Le jeu de références ne contient aucun signe.")
        recogniser_state["reference_signs"] = references
        recogniser_state["status"] = "ready"
    except Exception as error:  # Report setup errors through /api/health.
        recogniser_state["error"] = str(error)
        recogniser_state["status"] = "error"
        app.logger.exception("Could not load the DTW sign recogniser")


def normalize_label(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    normalized = "".join(char for char in decomposed if char.isalnum())
    return "ami" if normalized == "amie" else normalized


def label_folder(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.casefold())
    ascii_label = "".join(char for char in normalized if char.isalnum())
    if not ascii_label:
        raise ValueError("Le nom du signe doit contenir des lettres ou des chiffres.")
    return ascii_label[:50]


def dataset_catalog() -> list[dict]:
    catalog = {}
    supported = {".mp4", ".webm", ".mov"}
    for path in sorted(VIDEO_DIR.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in supported:
            continue
        if "user_uploads" in path.relative_to(VIDEO_DIR).parts:
            continue
        label = path.parent.name
        entry = catalog.setdefault(
            label,
            {
                "id": f"dataset:{label_folder(label)}",
                "name": label,
                "category": "Signes de base · dataset LSF",
                "source": "dataset",
                "mediaType": {
                    ".mp4": "video/mp4",
                    ".webm": "video/webm",
                    ".mov": "video/quicktime",
                }[path.suffix.lower()],
                "createdAt": 0,
                "learned": False,
                "videoCount": 0,
                "mediaUrl": None,
            },
        )
        entry["videoCount"] += 1
        if entry["mediaUrl"] is None:
            relative_path = path.relative_to(VIDEO_DIR).as_posix()
            entry["mediaUrl"] = "/api/dataset-video/" + "/".join(
                quote(part) for part in relative_path.split("/")
            )
    return list(catalog.values())


def sample_video_frames(
    video_path: str, duration_hint: float | None = None
) -> tuple[list[np.ndarray], list[int]]:
    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        raise ValueError(
            "Le serveur n’arrive pas à lire cette vidéo. Essaie un enregistrement WebM ou MP4."
        )

    try:
        fps = capture.get(cv2.CAP_PROP_FPS)
        if not np.isfinite(fps) or fps < 5 or fps > 120:
            # Some browser-recorded WebM files omit FPS metadata even though
            # OpenCV can decode their frames. Use the common webcam frame rate.
            fps = 30.0

        # Sample while decoding instead of relying on container duration/frame
        # count fields, which are often absent in MediaRecorder WebM output.
        rng = random.Random(0)
        sampled = []
        frame_index = 0
        if duration_hint is not None and duration_hint > MAX_CLIP_SECONDS:
            raise ValueError("La vidéo est trop longue. Enregistre un essai de 12 secondes maximum.")
        # Allow common 30/60/120 fps webcam streams even if reported FPS metadata
        # is slightly off; memory stays bounded by the fixed-size sample below.
        max_frames = int(120 * MAX_CLIP_SECONDS)
        while frame_index < max_frames:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_index < SAMPLED_FRAME_COUNT:
                sampled.append((frame_index, frame))
            else:
                replacement = rng.randrange(frame_index + 1)
                if replacement < SAMPLED_FRAME_COUNT:
                    sampled[replacement] = (frame_index, frame)
            frame_index += 1

        if frame_index >= max_frames:
            raise ValueError("La vidéo est trop longue. Enregistre un essai de 12 secondes maximum.")
        duration = duration_hint if duration_hint and duration_hint > 0 else frame_index / fps
        if duration < 1.0:
            raise ValueError("L’essai est trop court. Enregistre le signe pendant au moins une seconde.")
        if len(sampled) < 10:
            raise ValueError("La vidéo ne contient pas assez d’images lisibles.")
        sampled.sort(key=lambda item: item[0])
        frames = [frame for _, frame in sampled]
        timestamps = [
            int(index * duration * 1000 / max(1, frame_index - 1))
            for index, _ in sampled
        ]
        return frames, timestamps
    finally:
        capture.release()


def recognize_video(video_path: str, expected: str, duration_hint: float | None) -> dict:
    from models.sign_model import SignModel
    from utils.dtw import dtw_distances, rank_sign_classes
    from utils.landmark_utils import extract_landmarks
    from utils.mediapipe_utils import create_hand_landmarker, mediapipe_detection

    frames, timestamps = sample_video_frames(video_path, duration_hint)
    left_frames, right_frames = [], []
    with create_hand_landmarker() as hand_landmarker:
        for frame, timestamp_ms in zip(frames, timestamps):
            _, results = mediapipe_detection(frame, hand_landmarker, timestamp_ms)
            _, left_hand, right_hand = extract_landmarks(results)
            left_frames.append(left_hand)
            right_frames.append(right_hand)

    recorded_sign = SignModel(left_frames, right_frames)
    references = recogniser_state["reference_signs"].copy(deep=True)
    known_labels = {normalize_label(str(name)) for name in references["name"].unique()}
    distances = dtw_distances(recorded_sign, references)
    class_scores = rank_sign_classes(distances)
    if not class_scores:
        return {
            "prediction": "Signe inconnu",
            "expected": expected,
            "expected_available": normalize_label(expected) in known_labels,
            "matches_expected": False,
            "top_matches": [],
        }

    prediction = class_scores[0][0]
    return {
        "prediction": prediction,
        "expected": expected,
        "expected_available": normalize_label(expected) in known_labels,
        "matches_expected": (
            prediction != "Signe inconnu"
            and normalize_label(prediction) == normalize_label(expected)
        ),
        "top_matches": [
            {"name": name, "distance": score}
            for name, score in class_scores[:5]
        ],
    }


def refresh_reference_signs() -> None:
    from utils.dataset_utils import load_dataset, load_reference_signs

    videos = load_dataset()
    references = load_reference_signs(videos)
    recogniser_state["reference_signs"] = references
    recogniser_state["status"] = "ready"


def remove_cached_landmarks(relative_video: str) -> None:
    cache_folder = RECOGNISER_DIR / "data" / "dataset_tasks" / Path(relative_video).with_suffix("")
    if cache_folder.is_dir():
        for cache_file in cache_folder.iterdir():
            if cache_file.is_file():
                cache_file.unlink()
        cache_folder.rmdir()


@app.get("/")
def index():
    return send_from_directory(PLATFORM_DIR, "index.html")


@app.get("/<path:asset_path>")
def assets(asset_path: str):
    return send_from_directory(PLATFORM_DIR, asset_path)


@app.get("/api/health")
def health():
    return jsonify(
        status=recogniser_state["status"],
        error=recogniser_state["error"],
        labels=(
            sorted(str(name) for name in recogniser_state["reference_signs"]["name"].unique())
            if recogniser_state["reference_signs"] is not None
            else []
        ),
    )


@app.get("/api/signs")
def signs():
    return jsonify(signs=dataset_catalog())


@app.get("/api/dataset-video/<path:relative_path>")
def dataset_video(relative_path: str):
    return send_from_directory(VIDEO_DIR, relative_path, conditional=True)


@app.post("/api/user-reference")
def add_user_reference():
    if recogniser_state["status"] == "loading":
        return jsonify(error="Le reconnaisseur termine son chargement. Réessaie dans quelques instants."), 503
    uploaded = request.files.get("video")
    label = request.form.get("label", "").strip()
    if uploaded is None or not label:
        return jsonify(error="La vidéo ou le nom du signe manque."), 400
    suffix = Path(uploaded.filename or "").suffix.lower()
    if suffix not in {".webm", ".mp4", ".mov"}:
        return jsonify(error="Formats acceptés : MP4, MOV et WebM."), 415
    try:
        folder_name = label_folder(label)
    except ValueError as error:
        return jsonify(error=str(error)), 400

    relative_path = Path("user_uploads") / folder_name / f"user-{uuid.uuid4().hex}{suffix}"
    destination = VIDEO_DIR / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    previous_references = recogniser_state["reference_signs"]
    try:
        uploaded.save(destination)
        recogniser_state["status"] = "loading"
        from utils.landmark_utils import save_landmarks_from_video

        save_landmarks_from_video(str(relative_path.with_suffix("")))
        refresh_reference_signs()
        return jsonify(reference_id=relative_path.as_posix(), label=label), 201
    except Exception:
        if destination.exists():
            destination.unlink()
        remove_cached_landmarks(relative_path.as_posix())
        recogniser_state["reference_signs"] = previous_references
        recogniser_state["status"] = "ready" if previous_references is not None else "error"
        recogniser_state["error"] = None if previous_references is not None else (
            "La vidéo n’a pas pu être ajoutée aux références."
        )
        app.logger.exception("Could not add user video to the DTW references")
        return jsonify(
            error="La vidéo n’a pas pu être ajoutée aux références. Vérifie son format et essaie avec un clip court."
        ), 400


@app.delete("/api/user-reference")
def delete_user_reference():
    data = request.get_json(silent=True) or {}
    relative = Path(str(data.get("reference_id", "")))
    if len(relative.parts) != 3 or relative.parts[0] != "user_uploads" or not relative.name.startswith("user-"):
        return jsonify(error="Référence utilisateur invalide."), 400
    target = VIDEO_DIR / relative
    if not target.is_file():
        return jsonify(error="Cette vidéo utilisateur n’existe plus sur le serveur."), 404
    try:
        target.unlink()
        remove_cached_landmarks(relative.as_posix())
        refresh_reference_signs()
        return jsonify(deleted=True)
    except Exception:
        recogniser_state["status"] = "error"
        recogniser_state["error"] = "La référence a été supprimée, mais le modèle n’a pas pu être rechargé."
        app.logger.exception("Could not refresh the DTW references after removing a user video")
        return jsonify(error=recogniser_state["error"]), 500


@app.post("/api/recognize")
def recognize():
    if recogniser_state["status"] != "ready":
        message = recogniser_state["error"] or "Le reconnaisseur est encore en préparation. Réessaie dans quelques instants."
        return jsonify(error=message), 503
    uploaded = request.files.get("video")
    expected = request.form.get("expected", "").strip()
    if uploaded is None or not expected:
        return jsonify(error="La vidéo ou le nom du signe attendu manque."), 400
    if request.content_length and request.content_length > MAX_CLIP_BYTES + 1024 * 1024:
        return jsonify(error="La vidéo d’essai dépasse la limite de 40 Mo."), 413
    suffix = Path(uploaded.filename or "practice.webm").suffix.lower()
    if suffix not in {".webm", ".mp4", ".mov"}:
        return jsonify(error="Format vidéo non pris en charge. Utilise WebM ou MP4."), 415

    temporary_path = None
    try:
        try:
            duration_hint = float(request.form.get("duration_seconds", ""))
        except ValueError:
            duration_hint = None
        if duration_hint is not None and (not math.isfinite(duration_hint) or duration_hint <= 0):
            duration_hint = None
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            temporary_path = temporary.name
            uploaded.save(temporary)
        return jsonify(recognize_video(temporary_path, expected, duration_hint))
    except ValueError as error:
        return jsonify(error=str(error)), 400
    except Exception:
        app.logger.exception("Recognition request failed")
        return jsonify(error="L’analyse a échoué. Vérifie le format vidéo et le modèle MediaPipe."), 500
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.unlink(temporary_path)


@app.errorhandler(413)
def file_too_large(_error):
    return jsonify(error="Le fichier dépasse la taille maximale autorisée."), 413


if __name__ == "__main__":
    threading.Thread(target=load_recogniser, name="dtw-loader", daemon=True).start()
    app.run(host="127.0.0.1", port=8000, threaded=True)
