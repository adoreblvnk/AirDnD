# AirDnD Setup Guide: GCP ($10k Credits) & OpenAI ($100 Credits)

This guide covers setting up your Google Cloud Platform (GCP) project using the authenticated `gcloud` CLI, unlocking Google Photorealistic 3D Tiles and Vertex AI (Gemini), and configuring your OpenAI API key for real-time voice command and control.

---

## 1. Prerequisites

Authenticate the gcloud CLI and set the active project:

```bash
gcloud auth login
gcloud config set project airdnd-c2-sg-2026
```

---

## 2. GCP Project Setup

### Step 2.1: Create or Select the Project

```bash
# Create a new project (skip if it already exists)
gcloud projects create airdnd-c2-sg-2026 --name="AirDnD Defense C2"

# Or select the existing one
gcloud config set project airdnd-c2-sg-2026
```

### Step 2.2: Link Billing Account

```bash
# List available billing accounts
gcloud billing accounts list

# Link billing to the project
gcloud billing projects link airdnd-c2-sg-2026 \
  --billing-account=YOUR_BILLING_ACCOUNT_ID
```

### Step 2.3: Enable Required APIs

```bash
gcloud services enable \
  tile.googleapis.com \
  maps-backend.googleapis.com \
  places.googleapis.com \
  geocoding-backend.googleapis.com \
  aiplatform.googleapis.com \
  texttospeech.googleapis.com
```

### What each enabled API powers:

1. `tile.googleapis.com` (Map Tiles API): Powers **Photorealistic 3D Tiles** of Singapore (Singapore skyline, Jurong Island, Marina Bay).
2. `aiplatform.googleapis.com` (Vertex AI): Lets you run **Gemini 2.0 / 1.5 Flash** directly billed to your \$10k GCP credits for sub-second threat triage and decoy detection.
3. `texttospeech.googleapis.com` (Cloud Text-to-Speech): Generates realistic tactical radio announcements (*"Alert: 100 threats detected bearing 190"*).
4. `maps-backend.googleapis.com` & `places.googleapis.com`: Handles coordinate lookups and base satellite maps.

### Step 2.4: Create Google API Key for Web 3D Tiles

Create an API key restricted to the required map and tile APIs:

```bash
gcloud services api-keys create \
  --display-name="AirDnD 3D Tiles Key" \
  --api-target=service=tile.googleapis.com \
  --api-target=service=maps-backend.googleapis.com \
  --api-target=service=places.googleapis.com \
  --api-target=service=geocoding-backend.googleapis.com
```

Retrieve the key string (do NOT commit this — store it in `.env` which is gitignored):

```bash
gcloud services api-keys list
```

---

## 3. OpenAI API Setup ($100 Credits)

We use your OpenAI credits primarily for **Realtime Voice Control** (allowing the commander to speak directly into the microphone) and the high-speed HUD summarizer.

### Step 3.1: Generate Your Key
1. Go to: **[platform.openai.com/api-keys](https://platform.openai.com/api-keys)**.
2. Click **+ Create new secret key**.
3. Name it: `AirDnD-Voice-C2`.
4. Permissions: Standard (or All).
5. Copy the generated key (starts with `sk-proj-...`).

---

## 4. Cesium ion Setup (Free 3D Globe Token)

Even with Google 3D Tiles, CesiumJS requires an ion token to initialize the 3D globe camera and world terrain.
1. Sign up / Log in at: **[cesium.com/ion](https://cesium.com/ion)** (Free personal account).
2. Go to **Access Tokens** in the navigation bar.
3. Copy the **Default Token** (starts with `eyJ...`).

---

## 5. Local Environment Configuration (`.env`)

Create a `.env` file in the root of the project with your keys. **Never commit this file** — it is gitignored:

```bash
# ----------------------------------------------------
# AirDnD Tactical C2 Environment Variables
# ----------------------------------------------------

# 1. 3D Globe & Photorealistic Singapore Tiles (GCP)
GOOGLE_MAPS_API_KEY=AIzaSy...your-gcp-key-here
CESIUM_ION_TOKEN=eyJhbGci...your-cesium-token-here

# 2. Voice Commander & SITREP AI (OpenAI $100 Credits)
OPENAI_API_KEY=sk-proj-...your-openai-key-here
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_HUD_SUMMARY_MODEL=gpt-4o-mini

# 3. Tactical Reasoning via Vertex AI (GCP $10k Credits)
GCP_PROJECT_ID=airdnd-c2-sg-2026
GCP_REGION=asia-southeast1

# 4. Physical Hardware Node
ESP32_PORT=/dev/cu.usbmodem101
ESP32_BAUD=115200
```

> **Never commit real API keys.** Keep them in `.env` (gitignored) or macOS Keychain. The `.env.example` template contains placeholders only.

---

## 6. Verification Checklist

Run this quick test in your terminal to verify everything is working:

```bash
# 1. Verify GCP project is active and billing is linked
gcloud billing projects describe $(gcloud config get-value project)

# 2. Verify ESP32 is still mounted
ls -la /dev/cu.usbmodem101

# 3. Test OpenAI key (optional quick curl)
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | grep '"id": "gpt'
```
