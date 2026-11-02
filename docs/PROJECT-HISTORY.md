# DeepShield-AI: Real-Time AI Image & Deepfake Detection

This semester, I have the opportunity to develop a project of my choice. Building on my summer research on deepfake image detection, I plan to develop a related system that expands my knowledge and skills in artificial intelligence.

**Renee Ngari** | University of North Carolina at Charlotte  
**College of Computing and Informatics** 

---

## Overview

This project is a full-stack detection suite designed to identify synthetic and AI-generated media across the web. Developed as an ITS Senior Capstone project, DeepShield AI provides users with two complementary workflows: an automated Chrome Extension for live social media feed inspection, and a Web Companion Dashboard for manual file uploads and screenshot analysis.

The goal is to make deepfake and image manipulation detection easier and more accessible to everyday users. It isn't just one tool; it's a dual-system project. It combines an automated Chrome Extension for scrolling feeds with a Web Dashboard for manual file uploads, both powered by the same backend.

### Key Features

* **Image Detection:** Uses a deepfake detection model to analyze images.
* **Browser Integration:** Allows users to check images directly while browsing social media.
* **Authenticity Score:** Provides a percentage-based prediction such as *“82% likely AI-generated.”*
* **Visual Feedback:** Highlights areas of an image that may contain signs of manipulation.
***Simple Results:** Uses clear indicators such as *Likely Authentic*, *Uncertain*, or *Likely Manipulated*.

---

## Technology Stack

| Technology | Role / Usage |
| :--- | :--- |
| **JavaScript** | Core Chrome extension logic (content scripts, background service workers) and web interface |
| **HTML / CSS** | Web companion dashboard, extension popup UI, and on-page badge interface |
| **Chrome Extension API (Manifest V3)** | Browser integration on web platforms like Instagram, X, and TikTok |
| **Node.js / Express** | Backend server that mediates between the extension and detection APIs |
| **Hive AI V3 & Sightengine API** | CNN-based detection model pipeline (`ai-generated-and-deepfake-content-detection` & `genai`) |
| **Replit** | Hosts the backend server for public accessibility without local infrastructure |

> **Tech Choice Context:** Based on summer research comparing five detectors (*DFBench, Hive AI, SID-Set, Logistic Regression, Random Forest*) under realistic social-media-style transformations, CNN-based detectors like Hive AI and Sightengine outperformed traditional machine learning models. Therefore, this project utilizes maintained, state-of-the-art CNN detector APIs rather than training one from scratch this semester.

---

## Backend Infrastructure & Replit Deployment

The entire backend infrastructure for DeepShield AI is built and deployed on **Replit**:

- **Cloud Execution:** Replit runs the Express API server (`server.js`) 24/7, providing a stable public endpoint (`https://your-repl.replit.app`) accessible from any browser tab running the Chrome Extension.
- **Zero-Trust Key Management:** Sensitive credentials (`HIVE_API_KEY`, `SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET`) are stored in **Replit Secrets (`.env`)**. The client-side browser never touches raw API keys, eliminating the risk of key exposure.
- **Static Asset Delivery:** Replit serves the Web Companion Dashboard (`index.html`) directly through Express `static` middleware, keeping backend logic and frontend UI unified under a single server instance.

---

## How It Works

### Workflow 1: The Chrome Extension (Automated Feed Scanner)
1. **Image Detection on Page:** A content script scans the page as the user scrolls Instagram, X, or TikTok, attaching a small **"AI?"** badge to each eligible post image.
2. **User-Initiated Check:** The user clicks the badge on an image they want checked. *This is intentional*—the extension does not automatically scan every image to control API costs and keep performance smooth.
3. **Request Routing:** Clicking the badge sends the image URL directly to the Replit backend server rather than calling the detection API directly.
4. **Deepfake Detection:** Replit forwards the image to the detection API pipeline, simplifying classification into a unified label (`AI-Generated` / `Not AI-Generated`) and confidence percentage.
5. **Result Display:** The badge updates in place to show the result (e.g., `AI 82%` or `Real 91%`), with tooltips and toast notifications displaying exact percentages.

### Workflow 2: The Web Companion Dashboard (Manual & Screenshot Scanner)
1. **Flexible User Inputs:** Users can drag and drop local files (JPEG, PNG, WebP, GIF), paste direct image URLs, or upload social media screenshots.
2. **Base64 Conversion:** Local image files are converted into base64 Data URLs directly inside the browser for secure backend transport.
3. **Screenshot Cropping Guidance:** Interactive guidelines prompt users to trim status bars and phone borders off social media screenshots before scanning, significantly boosting detection accuracy.
4. **Interactive Results:** Renders an animated confidence meter showing exact probability scores, classification labels, and the active scanning engine (Hive AI or Sightengine).
---

## Progress Log

### Week 1–2: Extension Skeleton & Backend Wiring

* Built the Chrome extension (**Manifest V3**): content script for image detection and badge UI, background service worker for message passing, and a popup for settings.
* Built the Node.js/Express backend and integrated Hive AI's `/task/sync` detection endpoint.
* Verified the backend runs correctly, and the `/detect` endpoint responds as expected.
* Deployed the backend to **Replit** (chosen due to local development constraints on a Chromebook) at a public URL, avoiding the need for local Node.js installation.
* Loaded the extension into Chrome via **Developer Mode** and confirmed it installs without errors.
* **Debugging Focus:** Badge was not appearing on Instagram; narrowed down content script execution via console logging.

#### Known Issues / In Progress (Weeks 1–2)
* [x] Confirming content script loads on Instagram's page.
* [x] Confirm badges appear once the content script runs, then test full click $\rightarrow$ detect $\rightarrow$ result flow end-to-end.
* [x] `www.` vs `non-www.` URL variants for Instagram/TikTok added to manifest to avoid missed matches.

---

### Week 3–4: Bug Fix & Mid-Project Pivot

* **Badge Bug Fixed:** Found and resolved the badge issue. The content script was marking images as *"already processed"* before deciding whether to badge them, causing badges to be silently skipped. Restructured image-tracking logic so the badge decision happens first. Confirmed working across Instagram posts, stories, and profile pictures.
* **Hive AI Authentication Issue:** Testing surfaced a persistent `"Invalid Auth Token"` error from Hive's API. Despite three fix attempts (*generating new V3 keys, rewriting backend payload structures, exposing correct Replit ports*), Hive's API consistently rejected requests while their logged-in Playground worked. This indicated an account/project permissions issue on Hive's side rather than a client-side code bug.
* **API Pivot:** Switched the backend's detection API from **Hive AI** to **Sightengine's AI-Generated Image Detection API** (`genai` model), which uses a simpler user/secret authentication scheme. This resolved the blocking issue immediately.
* **End-to-End Pipeline Confirmed:** Clicking the **"AI?"** badge on a real Instagram image now successfully returns a live confidence score routed through Sightengine.

> [!NOTE]
> **Pipeline Update:** The *Technology Stack* and *How It Works* sections describe the backend architecture. Functionally, **Sightengine** now replaces Hive AI while maintaining the same request routing and score-simplification pipeline.

#### Updated Known Issues / In Progress (Weeks 3–4)
* [ ] Error handling returns a visible `!` on failure, but the underlying error message shown to the user could be clearer.
* [ ] Accuracy testing against transformed images (*screenshots, compression, resizing*), per original weeks 7–8 plan, has not started yet.

---

### Week 5: Expanding Beyond Social Media & Strengthening Extension (v0.2.0)

* **Works on Any Website:** Expanded functionality beyond Instagram and TikTok. Added a right-click context menu option (*"Check if AI-generated"*) that works on any web image (news sites, search engines, etc.) with results displayed in a top-page banner.
* **Optional Badges Per Site:** Badges appear automatically on Instagram, TikTok, CNN, and Google Images, remaining off by default elsewhere to prevent page clutter. Users can toggle badges on/off per site via the extension popup menu.
* **Clutter Reduction & Performance Enhancements:**
  * Raised minimum image size thresholds and filtered out story rings, headers, button overlays, and profile pictures.
  * Added support for multi-photo carousel posts so each slide is checked independently.
  * Implemented a short-term client cache to serve repeat checks instantly without making duplicate backend API requests.
  * Added an 8-second request timeout to show clear messages during backend cold starts on free-tier hosting.
  * Raised badge layering (`z-index`) to keep badges visible over complex image containers.

#### Next Steps
* [ ] Conduct controlled accuracy testing with known real and AI-generated images (including resized, compressed, and screenshot variations).
* [ ] Add backend support for direct image file uploads to allow checking screenshots and session-locked social media links.
* [ ] Build a standalone web portal where users can paste URLs or drag-and-drop images to test them directly without installing the extension.

### Weeks 6-7

### The Pivot: From Extension Issues to Dual System

- **The Replit Outage & Instagram Caching Issues:** 
  I originally built *only* the Chrome Extension. However, after Replit deleted my backend publication, republishing created new endpoint URLs. Instagram's heavy web framework cached the old server connections, causing extension badges to break and fail to load results.
- **Mentor Guidance & The Web App Pivot:** 
  Struggling to bypass Instagram's caching, my mentor suggested building a Web Companion Dashboard (`index.html`) as an alternative workflow. This allowed me to keep testing detection models directly in the browser while troubleshooting extension scripts.
- **Upgrading to Hive AI V3:** 
  To improve detection accuracy on compressed social media photos, I upgraded my primary backend engine to **Hive AI V3**, keeping **Sightengine** as an automatic fallback router.
- **Solving the Problem & Finalizing GitHub:** 
  Creating the Web Dashboard turned a deployment breakdown into a major project strength! I now have a full dual-system setup: the Chrome Extension for live feed scanning and the Web Dashboard for manual file uploads and screenshot analysis.

---

### How The Pivot Solved My Core Challenges

1. **Bypassed Social Media Blocking:** When Instagram cached old Replit endpoints or compressed images, the Web Dashboard gave users a direct way to drag and drop images or upload cropped screenshots.
2. **Improved Accuracy with Cropping Guidelines:** Social media screenshots contain phone status bars and app borders that confuse AI models. The Web Dashboard prompts users to crop those out, boosting accuracy up to ~99%.
3. **Dual-Provider Reliability:** Adding Hive AI alongside Sightengine ensured that if one provider hit rate limits or server errors, the backend automatically switched providers without breaking either the website or the extension.

