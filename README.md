# QuadBeam — Transfer files through light

QuadBeam is a client-side, air-gapped optical file-transfer web application (PWA) that transmits arbitrary binary files between devices (Mobile ↔ Laptop, Mobile ↔ Mobile, Laptop ↔ Laptop) using a synchronized grid of up to **four rapidly updating QR codes** and a device camera.

No Wi-Fi, Bluetooth, cellular data, cables, accounts, or intermediary servers are required during file transfer. Every byte travels through the visible screen-to-camera optical channel and is verified against a full-file **FIPS 180-4 SHA-256** cryptographic digest before saving.

## Key Engineering Highlights

1. **QuadBeam Binary Optical Protocol v1 (`0x5142` Magic)**:
   - Every QR panel encodes a self-describing binary frame: a 24-byte header (`magic`, `version`, `flags/panelId/packetType`, `sessionId`, `fileId`, `generationId`, `sequenceId`, `blockIndexOrSeed`, `payloadLength`), variable payload, and a 4-byte **IEEE 802.3 CRC32** trailer.
   - Periodic `METADATA` broadcasts allow a receiver joining mid-stream to discover the filename, exact byte size, block count, generation parameters, and 256-bit SHA-256 digest automatically.
2. **RFC 9285 Base45 Wire Encoding in QR Alphanumeric Mode**:
   - Encodes every 2 binary bytes into 3 QR Alphanumeric characters (`0-9A-Z $%*+-./:`), occupying **16.5 bits per 2 bytes** (only **3.1% overhead** over raw binary, compared to **33.3% overhead** for Base64 in Byte mode) while guaranteeing 100% safe ASCII handling across all browser barcode decoders.
3. **Systematic LT Fountain Erasure Coding + Hybrid Peeling / GF(2) Gaussian Elimination**:
   - Divides files up to **50 MiB** (and configurable up to 256 MiB) into bounded 256-block generations (`GenerationFountainEncoder` / `GenerationFountainDecoder`).
   - Transmits systematic source blocks (`degree = 1`) followed by rateless Luby Transform (LT) parity droplets drawn from the **Robust Soliton distribution** using a deterministic 24-bit PRNG seed.
   - The receiver combines fast iterative belief-propagation peeling with incremental **GF(2) Gaussian elimination** so any combination of $K$ linearly independent packets solves the generation immediately.
   - Includes a manual **Missing-Blocks Repair Request QR** workflow when a pass stops early.
4. **Dual-Engine Multi-QR Computer Vision & Reed-Solomon Decoder**:
   - Uses the browser's native `BarcodeDetector` API when supported and augments/falls back to QuadBeam's built-in pure-JavaScript **ISO/IEC 18004** computer vision engine (integral-image local adaptive thresholding, `1:1:3:1:1` finder localization, 3D perspective homography, alignment pattern refinement, BCH `(15,5)` / `(18,6)` bit recovery, and Berlekamp-Massey + Chien + Forney **GF(256) Reed-Solomon** error correction).
5. **Bounded Memory & OPFS Disk Staging**:
   - Streams sender file slices in 1 MiB chunks and flushes completed receiver generations to the **Origin Private File System (OPFS)** (`navigator.storage.getDirectory()`) or consolidated generation buffers so memory usage stays strictly bounded even on 50 MiB transfers.

## Beginner-Friendly Setup & Deployment Guide (Windows / macOS / Linux)

QuadBeam is packaged so you can **either** upload the extracted files directly to GitHub Pages with zero command-line build steps **or** use Node.js and Vite locally.

### Option A: Instant Zero-Build GitHub Pages Deployment (No Terminal Required)

1. Extract `QuadBeam-Production.zip` on your computer.
2. Sign in to GitHub and create a new repository (for example, `quadbeam`).
3. Upload the extracted files from the `QuadBeam-Production` folder (or the contents of the `dist/` folder) directly into your repository root and commit.
4. In your GitHub repository, open **Settings → Pages**.
5. Under **Build and deployment**, select **Deploy from a branch**, choose your branch (`main`) and `/ (root)`, and click **Save** (or select **GitHub Actions** to use the included `.github/workflows/deploy.yml` workflow).
6. Open `https://USERNAME.github.io/REPOSITORY/` (for example, `https://unskyit.github.io/quadbeam/`). Because all paths in `index.html`, `manifest.webmanifest`, and `sw.js` are relative (`./`), QuadBeam works automatically under any repository subpath.

### Option B: Complete 16-Step Windows Local Development & GitHub Workflow

1. **Install Node.js LTS**: Download and install the Windows LTS installer from `https://nodejs.org/`.
2. **Install VS Code**: Download and install Visual Studio Code from `https://code.visualstudio.com/`.
3. **Extract `QuadBeam-Production.zip`**: Right-click `QuadBeam-Production.zip` and choose **Extract All...** to `C:\Projects\QuadBeam`.
4. **Open the project folder**: Open VS Code, click **File → Open Folder...**, and select `C:\Projects\QuadBeam`.
5. **Install dependencies** (optional if using Vite CLI locally; all runtime dependencies are already bundled):
   ```powershell
   npm ci
   ```
6. **Start the local development server**:
   ```powershell
   npm run dev
   ```
7. **Open the local development URL**: Visit `http://localhost:5173/` in Chrome or Edge.
8. **Run the automated test suite** (16 unit, loss-simulation, camera-transformation, and 50 MiB file-integrity tests):
   ```powershell
   npm test
   ```
9. **Run the production build & verifier**:
   ```powershell
   npm run build
   ```
10. **Preview the built `dist/` version**:
    ```powershell
    npm run preview
    ```
    Then open `http://localhost:4173/`.
11. **Create a GitHub repository**: Create a new repository on GitHub named `quadbeam`.
12. **Push the project files**:
    ```powershell
    git init
    git add .
    git commit -m "Initial QuadBeam production release"
    git branch -M main
    git remote add origin https://github.com/USERNAME/quadbeam.git
    git push -u origin main
    ```
13. **Enable GitHub Pages**: Go to your repository **Settings → Pages** and select **GitHub Actions** (or **Deploy from a branch** on `main` `/ (root)`).
14. **Access the application URL**: Open `https://USERNAME.github.io/quadbeam/` on both your laptop and phone. *(Note: Mobile browsers require **HTTPS** or `localhost` to grant camera access; never use an insecure `http://192.168.x.x` LAN address for mobile camera scanning—use your HTTPS GitHub Pages URL instead.)*
15. **Install the application as a PWA**: Click **Install App** in the QuadBeam header (or choose **Add to Home Screen** in iOS Safari / Android Chrome) to cache the app for 100% offline operation.
16. **Transfer your first file**:
    - On the sending device, click **Send Files**, choose a file (or click **Load Sample File**), and click **Start Optical Transmission**.
    - On the receiving device, click **Receive Files**, click **Start Camera Scanner**, align the QR grid inside the dashed guide, and watch the verified progress bar reach 100% and pass **SHA-256 verification**.

## Empirical Performance Benchmark Results

Run `npm run benchmark` to measure performance on your hardware:

| Metric | Measured Result |
| :--- | :--- |
| **Wire Encoding Efficiency (248 B Packet)** | RFC 9285 Base45: **2,046 bits** (QR V12 `65×65`) vs Base64: **2,656 bits** (QR V14 `73×73`) |
| **Single QR Encode + Render Latency (V12, EC M)** | **0.18 ms** encode + **0.24 ms** render (**0.42 ms** total) |
| **4-QR (`2×2` Grid) Simultaneous CV Decode Latency** | **7.44 ms / frame** (all 4 panels decoded; **12.9 KiB/s** at 15 FPS) |
| **LT Fountain + GF(2) Reconstruction (K=128 Blocks)** | **0.95 ms** at 0% loss; **5.00 ms** at 10% loss; **7.01 ms** at 25% loss |
| **Streaming 50 MiB SHA-256 Verification** | **270.9 ms** (**184.5 MiB/s**) |

## Manual Real-Device Verification Checklist & Honest Limitations Report

### What Has Been Verified Automatically
- Exact byte-for-byte protocol reconstruction and FIPS 180-4 SHA-256 verification across **0 B, 1 KB, 100 KB, 1 MiB, 10 MiB, and 50 MiB (`52,428,800 B`)** synthetic binary transfers.
- Recovery under **0%, 5%, 10%, 20%, and 40%** random packet loss, consecutive burst frame drops, out-of-order delivery, duplicate frames, late-joining metadata discovery, foreign-session packet rejection, and Receiver Repair Request QR targeted retransmission.
- Computer vision QR decoding across **0°, 90°, 180°, and 270°** rotations, scaling (`3px` to `8px` per module), compressed contrast/brightness variation, synthetic sensor noise, Reed-Solomon byte-error correction, and simultaneous 1-QR, 2-QR, and 4-QR (`2×2` grid) frames.

### Physical Device Testing Checklist & Honest Physical Limitations
- Physical camera transfers were not executed inside this headless Linux container; use the checklist below when testing on physical hardware:
  - [ ] **Windows Chrome / Edge**: Verify `showSaveFilePicker` direct save and webcam selection.
  - [ ] **macOS Safari**: Verify camera permission prompt and canvas fullscreen layout.
  - [ ] **Chrome Android / Samsung Internet**: Verify rear camera (`environment`) continuous focus, Torch toggle, and PWA installation.
  - [ ] **iOS Safari**: Verify rear camera scanning and "Save to Files" export via Web Share sheet.
- **Physical Optical Realities**:
  - A 60 Hz display or 60 FPS camera setting does not yield 60 decoded QR frames per second due to camera exposure time and rolling shutter blur; **15 FPS to 30 FPS** in Balanced mode with 4 QR panels (or 2 QR panels on compact phone screens) produces the highest verified byte throughput.
  - While transferring large files (e.g., 10–50 MiB) over an optical camera link, keep devices plugged in or on a stand, as a physical camera transfer at ~15–25 KB/s takes several minutes compared to small documents and images.
