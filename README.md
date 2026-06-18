# Next Abstract

Next Abstract is a minimalist Next.js app for discovering unexpected academic research. It uses OpenAlex paper metadata, chooses a broad discipline at random, then fetches a random paper from that discipline.

## Run locally on macOS

1. Install Node.js if you do not already have it:

   ```bash
   brew install node
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Optional but recommended: copy the example environment file and add a free OpenAlex API key.

   ```bash
   cp .env.example .env.local
   ```

   Get an API key from https://openalex.org/settings/api and set `OPENALEX_API_KEY`.

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open http://localhost:3000 in your browser.

## Notes

- The app displays only real OpenAlex metadata and abstracts.
- It does not create user accounts, comments, summaries, or advertisements.
- Original paper links open in a new browser tab.
