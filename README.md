<div align="center">
  <h1 align="center">🧬 Periocular DNA Feature Extractor</h1>
  <p align="center">
    <strong>A modern, full-stack application for automated eye and eyebrow detection, profiling, and biometric scanning.</strong>
  </p>
  <p align="center">
    <a href="#features">Features</a> •
    <a href="#tech-stack">Tech Stack</a> •
    <a href="#installation">Installation</a> •
    <a href="#usage">Usage</a>
  </p>
</div>

---

## 🌟 Overview
The **Periocular DNA Feature Extractor** is an advanced vision application built to securely scan and extract human periocular regions (eyes, eyebrows, and skin tones). The app dynamically isolates these features via cutting-edge Machine Learning libraries and translates them into actionable data, such as a localized profile vector and an accurately quantified human-readable **Eye Color**.

## ✨ Features
* 📷 **Real-Time Registration:** Track facial landmarks natively in your browser using `face-api.js` to register profiles dynamically.
* 🤖 **Smart Scanning & Matching:** The software embeds periocular features and accurately identifies and pairs individuals from the live Webcam. 
* 🎨 **Robust Eye Color Extraction:** Utilizes `scikit-learn` K-Means Clustering on the Python backend to filter out pupil/sclera outliers, extracting pure geometric iris color effortlessly.
* 📊 **Profile Database System:** A clean, modern UI allows users to safely log into the Database tab to view, manage, and discard user logs without locking the system's hardware resources.
* 🔒 **Non-Destructive Background Storage:** Fully automated JSON compilation on the backend (`features.json`) for extended record keeping.

## 🛠 Tech Stack
### Frontend
- **Framework:** [Next.js](https://nextjs.org/) (React 18)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Vision Tracking:** [face-api.js](https://github.com/justadudewhohacks/face-api.js/)

### Backend
- **Framework:** [FastAPI](https://fastapi.tiangolo.com/) (Python)
- **Computer Vision:** [OpenCV](https://opencv.org/) & [MediaPipe](https://developers.google.com/mediapipe)
- **Machine Learning / Statistics:** [scikit-learn](https://scikit-learn.org/) & NumPy

---

## 🚀 Installation & Setup

You will need to run both the Frontend and the Backend servers locally to utilize the full feature set.

### 1. Backend (FastAPI / Python)
Open a terminal and navigate into the `backend/` directory:
```bash
# Navigate to the backend folder
cd backend

# Activate your virtual environment (Windows)
.\.venv\Scripts\activate
# OR (Mac/Linux): source .venv/bin/activate

# Install the required dependencies
pip install -r requirements.txt

# Start the Python API
uvicorn main:app --reload
```
*The backend will boot up at `http://localhost:8000`.*

### 2. Frontend (Next.js)
Open a separate terminal window at the root of the project:
```bash
# Install node packages
npm install

# Start the Next.js development server
npm run dev
```
*The frontend will boot up at `http://localhost:3000`.*

---

## 💻 Usage
1. Follow the browser link to `http://localhost:3000`.
2. Input an identification Name to access the Core Dashboard securely.
3. Switch between **Register Profile** (to save your features into the system), **Scan Face** (to test the system's ability to lock onto your registered face), and the **Database Tab** to access comprehensive visual metrics.

---
> *Built with ❤️ utilizing cutting-edge MediaPipe & Edge AI APIs.*
