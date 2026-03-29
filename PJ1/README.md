# StructoX — AI Structural Intelligence

Analyse architectural floor plans using computer vision:
- Wall detection (Hough Transform)
- Room detection (Contour analysis)
- Junction/corner counting (Harris Corner)
- Opening estimation (door/window gaps)
- Annotated result image with colour-coded overlays

---

## Project Structure

```
structox/
├── app.py                  ← Flask backend + CV pipeline
├── requirements.txt
├── templates/
│   └── index.html          ← Main UI
└── static/
    ├── css/style.css
    ├── js/main.js
    ├── uploads/            ← Auto-created: original images
    └── processed/          ← Auto-created: annotated images
```

---

## Setup & Run

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the server
python app.py

# 3. Open browser
http://127.0.0.1:5000
```

---

## How It Works

### `/process` endpoint (POST)

Accepts a multipart form upload (`file` field).

**Processing pipeline:**
1. **Pre-processing** — Grayscale + adaptive threshold + morphological cleanup
2. **Wall detection** — Canny edges → Probabilistic Hough Line Transform
3. **Room detection** — Dilate walls → find contours → filter by area
4. **Corner detection** — Harris Corner Detector
5. **Opening detection** — Count short line segments (door/window gaps)
6. **Annotation** — Colour-coded overlay: yellow=horizontal, blue=vertical, green=diagonal, red=rooms
7. **Scale estimate** — Heuristic pixel-to-metre ratio

**Response JSON:**
```json
{
  "success": true,
  "image_base64": "data:image/png;base64,...",
  "image_url": "/static/processed/xxx_processed.png",
  "count": 42,
  "analysis": {
    "image_size": { "width": 1200, "height": 900 },
    "walls": {
      "total": 42,
      "horizontal": 18,
      "vertical": 20,
      "diagonal": 4,
      "total_length_px": 38420,
      "estimated_length_m": 76.84
    },
    "rooms": [ { "id": 1, "label": "Bedroom / Large Room", ... } ],
    "room_count": 5,
    "corners_junctions": 312,
    "estimated_openings": { "count": 8 },
    "floor_coverage_pct": 62.3,
    "pixels_per_meter_estimate": 500.0
  }
}
```

---

## Tips for Best Results

- Use **high-contrast** scanned floor plans (black lines on white background)
- Minimum recommended image width: **800px**
- Supported formats: PNG, JPG, BMP, TIFF, WebP
- If rooms aren't detected, try increasing image resolution or contrast

---

## License
MIT
