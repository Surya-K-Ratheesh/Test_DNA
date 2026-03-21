// components/EyebrowExtractor.tsx
"use client";

import React, { useState } from "react";

export default function EyebrowExtractor() {
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [eyeColor, setEyeColor] = useState<string | null>(null);

  // Handle file selection
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedImage(file);
      setPreviewUrl(URL.createObjectURL(file));
      setStatus(""); // Reset status on new image
      setEyeColor(null);
    }
  };

  // Send the image to the Python FastAPI backend
  const handleUpload = async () => {
    if (!selectedImage) {
      setStatus("Please select an image first.");
      return;
    }

    setStatus("Sending image to Python backend...");
    
    // Package the file into a FormData object
    const formData = new FormData();
    formData.append("file", selectedImage);

    try {
      // This is the link! Calling your FastAPI server
      const response = await fetch("http://localhost:8000/api/extract-eyebrows", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      
      if (data.status === "success") {
        setStatus("Success! Features extracted and saved in the backend/extracted_features folder.");
        if (data.data && data.data.eye_color) {
          setEyeColor(data.data.eye_color);
        }
        console.log("Backend Response:", data);
      } else {
        setStatus(`Error from backend: ${data.message}`);
      }
    } catch (error) {
      console.error(error);
      setStatus("Failed to connect. Is your Python FastAPI server running in the terminal?");
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md space-y-4 border border-gray-200 mt-10">
      <h2 className="text-xl font-bold text-gray-900 text-center">
        DNA Phenotyping Feature Extractor
      </h2>
      
      <input 
        type="file" 
        accept="image/*" 
        onChange={handleImageChange}
        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
      />

      {previewUrl && (
        <img src={previewUrl} alt="Preview" className="w-full h-auto rounded-md border" />
      )}

      <button 
        onClick={handleUpload}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
      >
        Extract Features
      </button>

      {status && (
        <p className="text-sm font-medium text-gray-700 text-center mt-2">{status}</p>
      )}

      {eyeColor && (
        <div className="mt-4 p-4 rounded-md border text-center" style={{ backgroundColor: eyeColor + '20', borderColor: eyeColor }}>
          <p className="font-semibold text-gray-800">Detected Eye Color</p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <div className="w-8 h-8 rounded-full shadow-inner border border-gray-300" style={{ backgroundColor: eyeColor }}></div>
            <span className="text-sm font-mono">{eyeColor.toUpperCase()}</span>
          </div>
        </div>
      )}
    </div>
  );
}