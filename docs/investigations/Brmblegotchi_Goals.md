# Brmblegotchi Goals

## Project Overview
Brmblegotchi is a playful, virtual pet (Tamagotchi-style) experience, integrated right inside the Brmble VOIP client. This mini-feature gives users a simple, silent digital companion they can care for during their time in Brmble.

- **Frontend:** React + TypeScript + Vite (embedded via WebView2 in Brmble Client)
- **Client:** C# (.NET), hosting the frontend in a WebView2 control

## Project Goals
- Add a lighthearted, fun digital companion (Brmblegotchi) to enhance user engagement and enjoyment.
- Ensure the Tamagotchi is non-intrusive, does not interfere with VOIP features, and remains silent (no sound output).
- Facilitate a simple, snappy, and visually appealing gameplay loop.
- Design the feature to work seamlessly cross-platform wherever Brmble runs, with clear separation between core client and Tamagotchi code.
- Use modern, maintainable technologies for implementation, with React + TypeScript + Vite powering the UI and C# managing integration.

## Gameplay Loop & Success Criteria

**Gameplay Loop:**
1. User opens Brmble; their Brmblegotchi is visible and ready for interaction.
2. The pet shows its status through simple meters/visuals (hunger, happiness, cleanliness, etc.).
3. User can perform basic actions:
   - Feed the pet (refill hunger meter)
   - Play with the pet (increase happiness)
   - Clean the pet/environment (reset dirtiness)
   - (Optional: Put pet to rest to restore energy)
4. Pet visually reacts to care (animations, happy/sad faces, etc.).
5. Stats decay gently over real time, prompting users to return and care for their Brmblegotchi.
6. Pet never dies or runs away, but will show sadness if neglected.
7. State persists between app sessions.

**Success Criteria:**
- Brmblegotchi loads reliably, never disrupts core Brmble features.
- User can always access, interact with, and view their pet without confusion.
- All gameplay is visual; no Tamagotchi-generated audio.
- UI is smooth, responsive, and bug-free.
- Brmblegotchi logic/data is clearly modular/separated from main client logic.
- Pet stats, appearance, and state persist between user sessions.
- Stats decay reasonably, encouraging engagement but never punishing absence harshly.

## Stretch Goals (optional, post-MVP)
- Simple pet progression (e.g., ages/levels up with care)
- Cosmetic unlocks (hats, backgrounds, etc.)
- Simple badges/achievements ("7 days in a row cared for!")
- Social integrations (show your pet to friends)

## Out of Scope
- No audio or sound effects from Tamagotchi
- No micro-transactions or real-money purchases
- No advanced or complex simulations

---

**Summary:**
Brmblegotchi brings a simple, joyful, and non-intrusive Tamagotchi experience to Brmble. Users can care for, play with, and enjoy their pet directly in their VOIP client, boosting engagement and delight while never disrupting core communications.