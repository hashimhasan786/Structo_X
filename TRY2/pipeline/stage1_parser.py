"""
Stage 1 — Floor Plan Parser
============================
Detects and extracts:
  • Walls  (line segments, classified horizontal / vertical / diagonal)
  • Rooms  (enclosed regions via contour analysis)
  • Openings (doors & windows via gap detection)
  • Corners / junctions (Harris + T/L classification)

Returns:
  parsed_data  — structured dict with all geometry
  annotated    — BGR annotated image (numpy array)
"""

import cv2
import numpy as np
import math
import json
from collections import defaultdict


# ─── helpers ───────────────────────────────────────────────────────────────

def _angle(x1, y1, x2, y2):
    return math.degrees(math.atan2(abs(y2 - y1), abs(x2 - x1)))


def _length(x1, y1, x2, y2):
    return math.hypot(x2 - x1, y2 - y1)


def _snap(val, grid=5):
    return round(val / grid) * grid


def _snap_line(x1, y1, x2, y2, grid=5):
    return _snap(x1, grid), _snap(y1, grid), _snap(x2, grid), _snap(y2, grid)


def _midpoint(x1, y1, x2, y2):
    return (x1 + x2) / 2, (y1 + y2) / 2


# ─── main function ──────────────────────────────────────────────────────────

def parse_floor_plan(image_path: str) -> tuple:
    img_bgr = cv2.imread(image_path)
    if img_bgr is None:
        raise ValueError(f"Cannot read image: {image_path}")

    orig_h, orig_w = img_bgr.shape[:2]
    annotated = img_bgr.copy()

    # ── Pre-processing ──────────────────────────────────────────────────────
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    # Normalise exposure
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # Adaptive threshold (works on scanned + digital plans)
    binary = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=11, C=3
    )

    # Morphological clean-up
    k2 = np.ones((2, 2), np.uint8)
    k3 = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, k2, iterations=2)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN,  k2, iterations=1)

    # ── Wall / Line Detection ───────────────────────────────────────────────
    edges = cv2.Canny(gray, 30, 120, apertureSize=3, L2gradient=True)

    lines_raw = cv2.HoughLinesP(
        edges,
        rho=1, theta=np.pi / 180,
        threshold=60,
        minLineLength=25,
        maxLineGap=12
    )

    walls = []
    h_walls, v_walls, d_walls = [], [], []

    SNAP = 4   # pixel snap grid

    if lines_raw is not None:
        for ln in lines_raw:
            x1, y1, x2, y2 = ln[0]
            x1, y1, x2, y2 = _snap_line(x1, y1, x2, y2, SNAP)
            ang  = _angle(x1, y1, x2, y2)
            llen = _length(x1, y1, x2, y2)
            mx, my = _midpoint(x1, y1, x2, y2)

            if ang < 15:
                orient = "horizontal"
            elif ang > 75:
                orient = "vertical"
            else:
                orient = "diagonal"

            wall = {
                "id": len(walls),
                "x1": int(x1), "y1": int(y1),
                "x2": int(x2), "y2": int(y2),
                "length_px": round(llen, 1),
                "angle_deg": round(ang, 1),
                "orientation": orient,
                "midpoint": [round(mx, 1), round(my, 1)],
            }
            walls.append(wall)

            if orient == "horizontal":
                h_walls.append(wall)
                cv2.line(annotated, (x1, y1), (x2, y2), (0, 200, 255), 2)
            elif orient == "vertical":
                v_walls.append(wall)
                cv2.line(annotated, (x1, y1), (x2, y2), (255, 120, 30), 2)
            else:
                d_walls.append(wall)
                cv2.line(annotated, (x1, y1), (x2, y2), (0, 210, 120), 2)

    # ── Room Detection ──────────────────────────────────────────────────────
    wall_mask = np.zeros_like(binary)
    for w in walls:
        cv2.line(wall_mask, (w["x1"], w["y1"]), (w["x2"], w["y2"]), 255, 3)

    dil = cv2.dilate(wall_mask, np.ones((6, 6), np.uint8), iterations=3)
    closed = cv2.morphologyEx(dil, cv2.MORPH_CLOSE, np.ones((18, 18), np.uint8), iterations=2)

    contours, hier = cv2.findContours(closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)

    img_area = orig_w * orig_h
    rooms = []
    PALETTE = [
        (255,  80,  80), ( 80, 160, 255), ( 80, 255, 160),
        (255, 200,  80), (200,  80, 255), (255,  80, 200),
        ( 80, 220, 220), (255, 140,  50), (160, 255,  80),
        (220, 180, 255),
    ]

    overlay = annotated.copy()
    for i, cnt in enumerate(contours):
        area = cv2.contourArea(cnt)
        if img_area * 0.003 < area < img_area * 0.92:
            x, y, w, h = cv2.boundingRect(cnt)
            # Approximate polygon for better boundary
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
            aspect = round(w / h, 2) if h > 0 else 1.0
            label = _classify_room(w, h, area, orig_w, orig_h, i)
            rooms.append({
                "id": i + 1,
                "label": label,
                "bbox": {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
                "area_px": int(area),
                "aspect_ratio": aspect,
                "centroid": [int(x + w / 2), int(y + h / 2)],
                "poly_pts": len(approx),
            })
            col = PALETTE[len(rooms) % len(PALETTE)]
            cv2.fillPoly(overlay, [cnt], col)
            cv2.drawContours(annotated, [cnt], -1, (30, 30, 200), 2)
            cx, cy = x + w // 2, y + h // 2
            cv2.putText(annotated, f"R{len(rooms)}", (cx - 12, cy),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.52, (0, 0, 160), 2)

    cv2.addWeighted(overlay, 0.18, annotated, 0.82, 0, annotated)

    # ── Opening Detection ───────────────────────────────────────────────────
    # Openings appear as short line segments (gaps in walls)
    short_thresh = min(orig_w, orig_h) * 0.045
    long_thresh  = min(orig_w, orig_h) * 0.09
    openings = []
    for w in walls:
        if w["length_px"] < short_thresh:
            openings.append({**w, "type": "door_or_window"})
            cv2.line(annotated,
                     (w["x1"], w["y1"]), (w["x2"], w["y2"]),
                     (0, 255, 255), 3)
        elif w["length_px"] < long_thresh and w["orientation"] != "diagonal":
            openings.append({**w, "type": "window_candidate"})

    # ── Corner / Junction Detection & Classification ────────────────────────
    gray_f = np.float32(gray)
    harris = cv2.cornerHarris(gray_f, blockSize=4, ksize=3, k=0.04)
    harris = cv2.dilate(harris, None)
    thresh = 0.015 * harris.max()
    corner_pts = np.argwhere(harris > thresh)

    # Classify T vs L junctions
    junctions = []
    for pt in corner_pts[::6]:   # sample every 6th to avoid duplicates
        py, px = int(pt[0]), int(pt[1])
        # count nearby wall endpoints to distinguish T / L / X
        near_walls = sum(
            1 for ww in walls
            if min(_length(px, py, ww["x1"], ww["y1"]),
                   _length(px, py, ww["x2"], ww["y2"])) < 15
        )
        jtype = "X" if near_walls >= 4 else ("T" if near_walls == 3 else "L")
        junctions.append({"x": px, "y": py, "type": jtype})

    # ── Scale Estimation ────────────────────────────────────────────────────
    # Heuristic: largest enclosed room ≈ 5 m in longest dimension
    px_per_m = _estimate_scale(rooms, orig_w, orig_h)

    # Convert wall lengths to metres
    for ww in walls:
        ww["length_m"] = round(ww["length_px"] / px_per_m, 2)

    # ── Build outer boundary box ─────────────────────────────────────────────
    outer_box = _detect_outer_boundary(walls, orig_w, orig_h)

    # ── Legend overlay ─────────────────────────────────────────────────────
    _draw_legend(annotated, len(walls), len(rooms), len(junctions), len(openings))

    parsed_data = {
        "image_size": {"w": orig_w, "h": orig_h},
        "scale": {"px_per_m": round(px_per_m, 2), "note": "heuristic estimate"},
        "walls": walls,
        "wall_summary": {
            "total": len(walls),
            "horizontal": len(h_walls),
            "vertical": len(v_walls),
            "diagonal": len(d_walls),
            "total_length_px": int(sum(w["length_px"] for w in walls)),
            "total_length_m": round(sum(w["length_px"] for w in walls) / px_per_m, 2),
        },
        "rooms": rooms,
        "room_count": len(rooms),
        "openings": openings,
        "opening_count": len(openings),
        "junctions": junctions[:200],   # cap for JSON size
        "junction_count": len(junctions),
        "outer_boundary": outer_box,
    }

    return parsed_data, annotated


# ─── helpers ───────────────────────────────────────────────────────────────

def _classify_room(w, h, area_px, img_w, img_h, idx):
    ratio = area_px / (img_w * img_h)
    aspect = w / h if h else 1
    labels = [
        "Living Room / Great Room",
        "Master Bedroom",
        "Bedroom",
        "Kitchen",
        "Dining Area",
        "Bathroom",
        "Laundry",
        "Foyer / Entry",
        "Corridor / Passage",
        "Storage / Utility",
    ]
    if ratio > 0.22:   return "Living Room / Great Room"
    if ratio > 0.14:   return "Master Bedroom"
    if ratio > 0.08:   return "Bedroom"
    if ratio > 0.05:   return "Kitchen / Dining"
    if aspect > 2.8 or aspect < 0.35:  return "Corridor / Passage"
    if ratio < 0.025:  return "Bathroom / WC"
    return labels[idx % len(labels)]


def _estimate_scale(rooms, img_w, img_h):
    if not rooms:
        return max(img_w, img_h) / 12
    largest = max(rooms, key=lambda r: r["area_px"])
    px_dim = max(largest["bbox"]["w"], largest["bbox"]["h"])
    assumed_m = 5.5   # largest room ≈ 5.5 m longest dimension
    return px_dim / assumed_m if px_dim > 0 else max(img_w, img_h) / 12


def _detect_outer_boundary(walls, img_w, img_h):
    """Return approximate outer boundary as bounding box of all wall endpoints."""
    if not walls:
        return {"x": 0, "y": 0, "w": img_w, "h": img_h}
    xs = [w["x1"] for w in walls] + [w["x2"] for w in walls]
    ys = [w["y1"] for w in walls] + [w["y2"] for w in walls]
    x0, y0 = min(xs), min(ys)
    x1, y1 = max(xs), max(ys)
    return {"x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0)}


def _draw_legend(img, wall_cnt, room_cnt, junc_cnt, open_cnt):
    items = [
        ("Walls",     str(wall_cnt), (0, 200, 255)),
        ("Rooms",     str(room_cnt), (30,  30, 200)),
        ("Junctions", str(junc_cnt), (0,  200, 100)),
        ("Openings",  str(open_cnt), (0,  240, 240)),
    ]
    bx, by, bw = 8, 8, 200
    bh = 14 + len(items) * 20
    cv2.rectangle(img, (bx, by), (bx + bw, by + bh), (15, 15, 15), -1)
    cv2.rectangle(img, (bx, by), (bx + bw, by + bh), (80, 80, 80), 1)
    for i, (lbl, val, col) in enumerate(items):
        ty = by + 22 + i * 20
        cv2.putText(img, f"{lbl}: {val}", (bx + 8, ty),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.46, col, 1, cv2.LINE_AA)
