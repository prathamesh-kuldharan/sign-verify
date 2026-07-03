import cv2
import numpy as np
import os
import joblib
import tempfile
from flask import Flask, request, jsonify
from flask_cors import CORS
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.metrics import accuracy_score, confusion_matrix
from werkzeug.utils import secure_filename

# Tell Flask that static files and templates live inside the frontend directory
app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

# -------- FRONTEND SERVING --------
@app.route("/")
def serve_frontend():
    return app.send_static_file("index.html")

MODEL_PATH = "model.pkl"
DATASET_GENUINE = "dataset/genuine"
DATASET_FORGED = "dataset/forged"
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "bmp", "webp"}

# -------- PREPROCESSING --------
def preprocess_path(image_path):
    img = cv2.imread(image_path, 0)
    if img is None:
        raise ValueError(f"Could not read image: {image_path}")
    img = cv2.resize(img, (100, 100))
    img = cv2.GaussianBlur(img, (5, 5), 0)
    return img

def preprocess_bytes(file_bytes):
    arr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("Could not decode image from bytes")
    img = cv2.resize(img, (100, 100))
    img = cv2.GaussianBlur(img, (5, 5), 0)
    return img

def extract_features(img):
    return img.flatten()

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

# -------- LOAD MODEL ON STARTUP --------
model = None
model_accuracy = None
model_trained = False

def load_model():
    global model, model_accuracy, model_trained
    if os.path.exists(MODEL_PATH):
        data = joblib.load(MODEL_PATH)
        model = data["model"]
        model_accuracy = data.get("accuracy")
        model_trained = True
        print(f"✅ Model loaded (accuracy: {model_accuracy})")
    else:
        print("⚠️  No trained model found. Train via POST /api/train")

load_model()

# -------- ROUTES --------

@app.route("/api/status", methods=["GET"])
def status():
    genuine_count = 0
    forged_count = 0
    if os.path.exists(DATASET_GENUINE):
        genuine_count = len([f for f in os.listdir(DATASET_GENUINE) if allowed_file(f)])
    if os.path.exists(DATASET_FORGED):
        forged_count = len([f for f in os.listdir(DATASET_FORGED) if allowed_file(f)])

    return jsonify({
        "model_trained": model_trained,
        "accuracy": model_accuracy,
        "dataset": {
            "genuine": genuine_count,
            "forged": forged_count,
        }
    })


@app.route("/api/train", methods=["POST"])
def train():
    global model, model_accuracy, model_trained

    if not os.path.exists(DATASET_GENUINE) or not os.path.exists(DATASET_FORGED):
        return jsonify({"error": "Dataset folders not found. Ensure dataset/genuine and dataset/forged exist."}), 400

    X, y = [], []

    genuine_files = [f for f in os.listdir(DATASET_GENUINE) if allowed_file(f)]
    forged_files = [f for f in os.listdir(DATASET_FORGED) if allowed_file(f)]

    if len(genuine_files) == 0 or len(forged_files) == 0:
        return jsonify({"error": "Dataset folders are empty."}), 400

    for file in genuine_files:
        path = os.path.join(DATASET_GENUINE, file)
        try:
            img = preprocess_path(path)
            X.append(extract_features(img))
            y.append(1)
        except Exception:
            pass

    for file in forged_files:
        path = os.path.join(DATASET_FORGED, file)
        try:
            img = preprocess_path(path)
            X.append(extract_features(img))
            y.append(0)
        except Exception:
            pass

    X = np.array(X)
    y = np.array(y)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    knn = KNeighborsClassifier(n_neighbors=3)
    knn.fit(X_train, y_train)

    y_pred = knn.predict(X_test)
    acc = round(accuracy_score(y_test, y_pred) * 100, 2)
    cm = confusion_matrix(y_test, y_pred).tolist()

    joblib.dump({"model": knn, "accuracy": acc}, MODEL_PATH)

    model = knn
    model_accuracy = acc
    model_trained = True

    return jsonify({
        "success": True,
        "accuracy": acc,
        "confusion_matrix": cm,
        "samples": {"genuine": len(genuine_files), "forged": len(forged_files)},
        "model": "KNN (k=3)",
    })


@app.route("/api/upload-dataset", methods=["POST"])
def upload_dataset():
    """Upload images to genuine or forged dataset folder."""
    label = request.form.get("label")  # 'genuine' or 'forged'
    if label not in ("genuine", "forged"):
        return jsonify({"error": "label must be 'genuine' or 'forged'"}), 400

    folder = DATASET_GENUINE if label == "genuine" else DATASET_FORGED
    os.makedirs(folder, exist_ok=True)

    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files provided"}), 400

    saved = []
    for f in files:
        if f and allowed_file(f.filename):
            filename = secure_filename(f.filename)
            dest = os.path.join(folder, filename)
            f.save(dest)
            saved.append(filename)

    return jsonify({"success": True, "saved": saved, "count": len(saved)})


@app.route("/api/predict", methods=["POST"])
def predict():
    if not model_trained or model is None:
        return jsonify({"error": "Model not trained yet. Please train the model first."}), 400

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if not file or not allowed_file(file.filename):
        return jsonify({"error": "Invalid file type"}), 400

    try:
        file_bytes = file.read()
        img = preprocess_bytes(file_bytes)
        features = extract_features(img)

        prediction = model.predict([features])[0]
        # KNN vote-fraction confidence: 2/3 agree = 67%, 3/3 = 100%
        proba = model.predict_proba([features])[0]
        confidence = round(float(max(proba)) * 100, 1)

        return jsonify({
            "prediction": "genuine" if prediction == 1 else "forged",
            "label": int(prediction),
            "confidence": confidence,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    os.makedirs(DATASET_GENUINE, exist_ok=True)
    os.makedirs(DATASET_FORGED, exist_ok=True)
    
    # Read the dynamic port assigned by Render's virtual router
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)