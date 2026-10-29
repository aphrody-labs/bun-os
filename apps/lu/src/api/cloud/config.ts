// Bun OS fork: LU Cloud (the upstream author's hosted tier at lu-labs.ai, backed by
// his Supabase project) is DISABLED. Nothing in the app talks to those servers.
//
// To point the cloud client at a deployment that you operate, set all three at build
// time: VITE_LU_CLOUD_URL, VITE_LU_SUPABASE_URL and VITE_LU_SUPABASE_ANON_KEY.
// Without them CLOUD_ENABLED is false, every cloud call fails closed before it
// touches the network, and the local engine (aphrody-llama-server, Ollama, LM Studio)
// is the only inference path. See docs/ai/PROVENANCE.md.

export const CLOUD_BASE: string = (import.meta.env.VITE_LU_CLOUD_URL as string | undefined) ?? ''

export const SUPABASE_URL: string = (import.meta.env.VITE_LU_SUPABASE_URL as string | undefined) ?? ''

export const SUPABASE_ANON_KEY: string = (import.meta.env.VITE_LU_SUPABASE_ANON_KEY as string | undefined) ?? ''

export const CLOUD_ENABLED: boolean = CLOUD_BASE !== '' && SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== ''
