# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Recruitment Hub setup

The Recruitment Hub uses its own Supabase Auth session, database tables, storage buckets, and Row Level Security policies. It does not change screenplay generation or the audio features.

1. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` plus `VITE_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`) from your Supabase project.
2. Apply `supabase/migrations/20261124000000_recruitment_hub.sql` to that project using the Supabase SQL editor or Supabase CLI.
3. Enable email/password sign-in in Supabase Auth, then run `npm run dev`.

Only a publishable/anon key belongs in frontend configuration. Never expose a Supabase secret or service-role key in the browser or commit it to the repository.

## Deployment

The Vercel API route at `/api/openrouter` keeps the OpenRouter credential on the server. Set `OPENROUTER_API_KEY` as a server-only environment variable in Vercel, plus `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the frontend. Do not use a `VITE_` prefix for the OpenRouter key. Use an OpenRouter key with a spending limit; the API route also applies same-origin checks and a best-effort per-instance request limit.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
