from flask import Flask, request, jsonify, render_template
import cv2
import numpy as np
from modules.parser import detect_walls

app = Flask(__name__)

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/process", methods=["POST"])
def process():
    file = request.files["file"]

    img = cv2.imdecode(
        np.frombuffer(file.read(), np.uint8),
        cv2.IMREAD_COLOR
    )

    walls, debug_img = detect_walls(img)

    cv2.imwrite("static/output.png", debug_img)

    return jsonify({
        "image_url": "http://127.0.0.1:5000/static/output.png",
        "count": len(walls) if walls is not None else 0
    })

if __name__ == "__main__":
    app.run(debug=True)
    
