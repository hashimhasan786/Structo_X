from flask import Flask, request, jsonify, render_template, send_from_directory
import cv2
import numpy as np
from PIL import Image
import base64
import io
import os
import uuid
import json
import math

app = Flask(__name__)

UPLOAD_FOLDER = os.path.join("static", "uploads")
PROCESSED_FOLDER = os.path.join("static", "processed")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(PROCESSED_FOLDER, exist_ok=True)

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["PROCESSED_FOLDER"] = PROCESSED_FOLDER
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "bmp", "tiff", "webp"}


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def analyze_floor_plan(image_path):
    """
    Full structural analysis of floor plan image:
    - Detects walls (lines) via Hough Transform
    - Identifies rooms via contour detection
    - Measures approximate dimensions
    - Counts openings (doors/windows) via gap detection
    - Estimates area ratios
    Returns annotated image + structured analysis dict.
    """
    img_bgr = cv2.imread(image_path)
    if img_bgr is None:
        raise ValueError("Could not read image file.")

    orig_h, orig_w = img_bgr.shape[:2]
    annotated = img_bgr.copy()

    # ---------- Pre-processing ----------
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    # Adaptive threshold to handle varied scan quality
    binary = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=15, C=4
    )

    # Remove tiny noise
    kernel = np.ones((2, 2), np.uint8)
    cleaned = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)

    # ---------- Wall / Line Detection ----------
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)

    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=80,
        minLineLength=40,
        maxLineGap=10
    )

    wall_count = 0
    horizontal_walls = []
    vertical_walls = []
    diagonal_walls = []
    total_wall_length_px = 0

    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = line[0]
            angle = math.degrees(math.atan2(abs(y2 - y1), abs(x2 - x1)))
            length = math.hypot(x2 - x1, y2 - y1)
            total_wall_length_px += length

            if angle < 15:          # Horizontal
                horizontal_walls.append(line[0])
                cv2.line(annotated, (x1, y1), (x2, y2), (0, 200, 255), 2)
            elif angle > 75:        # Vertical
                vertical_walls.append(line[0])
                cv2.line(annotated, (x1, y1), (x2, y2), (255, 100, 0), 2)
            else:                   # Diagonal
                diagonal_walls.append(line[0])
                cv2.line(annotated, (x1, y1), (x2, y2), (0, 180, 100), 2)

            wall_count += 1

    # ---------- Room / Contour Detection ----------
    # Dilate walls to close gaps, then find enclosed regions
    wall_kernel = np.ones((5, 5), np.uint8)
    dilated = cv2.dilate(cleaned, wall_kernel, iterations=3)
    filled = cv2.morphologyEx(dilated, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8), iterations=2)

    contours, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    rooms = []
    min_room_area = (orig_w * orig_h) * 0.005   # at least 0.5% of image
    max_room_area = (orig_w * orig_h) * 0.95

    colors_room = [
        (255, 80, 80, 60), (80, 160, 255, 60), (80, 255, 160, 60),
        (255, 200, 80, 60), (200, 80, 255, 60), (255, 80, 200, 60),
        (80, 220, 220, 60), (255, 140, 50, 60),
    ]

    overlay = annotated.copy()
    for i, cnt in enumerate(contours):
        area = cv2.contourArea(cnt)
        if min_room_area < area < max_room_area:
            x, y, w, h = cv2.boundingRect(cnt)
            aspect = round(w / h, 2) if h > 0 else 0
            rooms.append({
                "id": i + 1,
                "x": int(x), "y": int(y),
                "width_px": int(w), "height_px": int(h),
                "area_px": int(area),
                "aspect_ratio": aspect,
                "label": classify_room(w, h, area, orig_w, orig_h)
            })
            color = colors_room[i % len(colors_room)]
            cv2.fillPoly(overlay, [cnt], color[:3])
            cv2.drawContours(annotated, [cnt], -1, (0, 0, 220), 2)
            cx, cy = x + w // 2, y + h // 2
            cv2.putText(annotated, f"R{i+1}", (cx - 10, cy),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 180), 2)

    cv2.addWeighted(overlay, 0.25, annotated, 0.75, 0, annotated)

    # ---------- Corner / Junction Detection ----------
    gray_f = np.float32(gray)
    corners_map = cv2.cornerHarris(gray_f, blockSize=4, ksize=3, k=0.04)
    corners_map = cv2.dilate(corners_map, None)
    corner_threshold = 0.02 * corners_map.max()
    corner_points = np.argwhere(corners_map > corner_threshold)
    corner_count = len(corner_points)

    # ---------- Opening (Door/Window) Detection ----------
    # Short horizontal/vertical line gaps suggest openings
    openings = detect_openings(lines, orig_w, orig_h)

    # ---------- Scale Estimation ----------
    # Heuristic: assume longest wall ≈ longest room dimension
    # Provide pixel-to-meter ratio as estimate
    pixels_per_meter = estimate_scale(orig_w, orig_h, rooms)

    # ---------- Summary Metrics ----------
    total_wall_length_m = round(total_wall_length_px / pixels_per_meter, 2) if pixels_per_meter else None
    image_area_px = orig_w * orig_h
    total_room_area_px = sum(r["area_px"] for r in rooms)
    coverage_pct = round(total_room_area_px / image_area_px * 100, 1) if image_area_px else 0

    # Annotate legend
    draw_legend(annotated, wall_count, len(rooms), corner_count, openings)

    return annotated, {
        "image_size": {"width": orig_w, "height": orig_h},
        "walls": {
            "total": wall_count,
            "horizontal": len(horizontal_walls),
            "vertical": len(vertical_walls),
            "diagonal": len(diagonal_walls),
            "total_length_px": int(total_wall_length_px),
            "estimated_length_m": total_wall_length_m,
        },
        "rooms": rooms,
        "room_count": len(rooms),
        "corners_junctions": corner_count,
        "estimated_openings": openings,
        "floor_coverage_pct": coverage_pct,
        "pixels_per_meter_estimate": round(pixels_per_meter, 2) if pixels_per_meter else None,
    }


def classify_room(w, h, area_px, img_w, img_h):
    """Heuristic room label based on proportions."""
    area_ratio = area_px / (img_w * img_h)
    aspect = w / h if h else 1
    if area_ratio > 0.25:
        return "Main Hall / Living Room"
    elif area_ratio > 0.12:
        return "Bedroom / Large Room"
    elif area_ratio > 0.06:
        return "Kitchen / Dining"
    elif aspect > 2.5 or aspect < 0.4:
        return "Corridor / Passage"
    elif area_ratio < 0.03:
        return "Bathroom / Utility"
    else:
        return "Room"


def detect_openings(lines, img_w, img_h):
    """Estimate door/window openings from line gap patterns."""
    if lines is None:
        return {"count": 0, "details": []}
    gap_threshold = min(img_w, img_h) * 0.04
    short_lines = [l[0] for l in lines
                   if math.hypot(l[0][2]-l[0][0], l[0][3]-l[0][1]) < gap_threshold]
    return {
        "count": len(short_lines),
        "note": "Short segments typically indicate door/window openings"
    }


def estimate_scale(img_w, img_h, rooms):
    """Rough pixels-per-meter estimate: assume largest room ≈ 5m × 4m."""
    if not rooms:
        return max(img_w, img_h) / 10
    largest = max(rooms, key=lambda r: r["area_px"])
    assumed_real_m = 5.0   # assumed ~5 m for largest dimension
    px_dim = max(largest["width_px"], largest["height_px"])
    return px_dim / assumed_real_m if px_dim > 0 else max(img_w, img_h) / 10


def draw_legend(img, wall_count, room_count, corners, openings):
    h, w = img.shape[:2]
    legend_items = [
        ("Walls detected", str(wall_count), (0, 200, 255)),
        ("Rooms detected", str(room_count), (0, 0, 220)),
        ("Junctions/Corners", str(corners), (200, 200, 0)),
        ("Est. Openings", str(openings["count"]), (0, 180, 100)),
    ]
    box_x, box_y = 10, 10
    box_w, box_h = 230, 20 + len(legend_items) * 22
    cv2.rectangle(img, (box_x, box_y), (box_x + box_w, box_y + box_h),
                  (20, 20, 20), -1)
    cv2.rectangle(img, (box_x, box_y), (box_x + box_w, box_y + box_h),
                  (100, 100, 100), 1)
    for i, (label, val, color) in enumerate(legend_items):
        ty = box_y + 26 + i * 22
        cv2.putText(img, f"{label}: {val}", (box_x + 10, ty),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.48, color, 1, cv2.LINE_AA)


# ─────────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/process", methods=["POST"])
def process():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if file.filename == "" or not allowed_file(file.filename):
        return jsonify({"error": "Invalid or no file selected"}), 400

    uid = uuid.uuid4().hex[:10]
    ext = file.filename.rsplit(".", 1)[1].lower()
    upload_filename = f"{uid}_orig.{ext}"
    upload_path = os.path.join(UPLOAD_FOLDER, upload_filename)
    file.save(upload_path)

    try:
        annotated_img, analysis = analyze_floor_plan(upload_path)

        processed_filename = f"{uid}_processed.png"
        processed_path = os.path.join(PROCESSED_FOLDER, processed_filename)
        cv2.imwrite(processed_path, annotated_img)

        # Encode processed image as base64 for inline display
        _, buffer = cv2.imencode(".png", annotated_img)
        b64_image = base64.b64encode(buffer).decode("utf-8")

        return jsonify({
            "success": True,
            "image_base64": f"data:image/png;base64,{b64_image}",
            "image_url": f"/static/processed/{processed_filename}",
            "count": analysis["walls"]["total"],
            "analysis": analysis
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory("static", filename)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
