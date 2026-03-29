"""
StructoX — Autonomous Structural Intelligence System
Flask backend wiring all 5 pipeline stages.
"""

import os
import uuid
import base64
import json
import cv2

from flask import Flask, request, jsonify, render_template, send_from_directory

from pipeline.stage1_parser   import parse_floor_plan
from pipeline.stage2_geometry import reconstruct_geometry
from pipeline.stage3_model3d  import generate_3d_model
from pipeline.stage4_materials import analyse_materials
from pipeline.stage5_explain  import generate_explanation

app = Flask(__name__)

UPLOAD_DIR    = os.path.join("static", "uploads")
PROCESSED_DIR = os.path.join("static", "processed")
os.makedirs(UPLOAD_DIR,    exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)

ALLOWED = {"png", "jpg", "jpeg", "bmp", "tiff", "webp"}


def _allowed(fn):
    return "." in fn and fn.rsplit(".", 1)[1].lower() in ALLOWED


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/process", methods=["POST"])
def process():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if not file.filename or not _allowed(file.filename):
        return jsonify({"error": "Invalid file type"}), 400

    uid  = uuid.uuid4().hex[:10]
    ext  = file.filename.rsplit(".", 1)[1].lower()
    path = os.path.join(UPLOAD_DIR, f"{uid}.{ext}")
    file.save(path)

    results = {}
    stage   = "init"

    try:
        # ── Stage 1: Parse ────────────────────────────────────────────────
        stage = "parsing"
        parsed, annotated_img = parse_floor_plan(path)
        results["stage1"] = parsed

        # Save annotated image
        proc_name = f"{uid}_s1.png"
        proc_path = os.path.join(PROCESSED_DIR, proc_name)
        cv2.imwrite(proc_path, annotated_img)
        _, buf = cv2.imencode(".png", annotated_img)
        b64 = base64.b64encode(buf).decode("utf-8")
        results["annotated_image_b64"] = f"data:image/png;base64,{b64}"
        results["annotated_image_url"] = f"/static/processed/{proc_name}"

        # ── Stage 2: Geometry ─────────────────────────────────────────────
        stage = "geometry"
        geometry = reconstruct_geometry(parsed)
        results["stage2"] = geometry

        # ── Stage 3: 3D Model ─────────────────────────────────────────────
        stage = "3d_model"
        model3d = generate_3d_model(geometry, parsed)
        results["stage3"] = model3d

        # ── Stage 4: Materials ────────────────────────────────────────────
        stage = "materials"
        # Pass classified_walls to geometry for material stage
        geometry["classified_walls"] = geometry.get("classified_walls", [])
        material_analysis = analyse_materials(geometry)
        results["stage4"] = material_analysis

        # ── Stage 5: Explainability ───────────────────────────────────────
        stage = "explainability"
        explanation = generate_explanation(parsed, geometry, material_analysis)
        results["stage5"] = explanation

        results["success"] = True
        results["uid"] = uid

        return jsonify(results)

    except Exception as e:
        return jsonify({
            "error": str(e),
            "stage": stage,
            "success": False,
        }), 500


@app.route("/static/<path:fn>")
def static_files(fn):
    return send_from_directory("static", fn)


if __name__ == "__main__":
    app.run(debug=True, port=5000, host="0.0.0.0")
