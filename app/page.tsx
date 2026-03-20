import React from "react";
import dynamic from "next/dynamic";
import EyebrowExtractor from "../components/EyebrowExtractor";

// Dynamically import the Periocular component to disable SSR, 
// preserving your original configuration.
const Periocular = dynamic(() => import("../components/Periocular"), { ssr: false });

export default function Page() {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
      
      {/* Page Header section */}
      <div className="text-center max-w-3xl w-full mb-12">
        <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight sm:text-5xl">
          DNA Phenotyping Dashboard
        </h1>
        <p className="mt-4 text-lg text-gray-500">
          Upload a facial image to detect and extract features using the Python machine learning backend.
        </p>
      </div>

      <div className="max-w-4xl w-full space-y-12">
        
        {/* Your Original Periocular Component */}
        <div className="w-full rounded-lg bg-gray-800 p-6 shadow-lg">
          <h2 className="text-2xl font-semibold mb-4 text-white">Periocular Recognition Demo</h2>
          <Periocular />
        </div>

        {/* The New Eyebrow Extractor Component */}
        <div className="w-full">
          <EyebrowExtractor />
        </div>

      </div>
      
    </main>
  );
}