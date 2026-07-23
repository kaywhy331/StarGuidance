# Security and privacy

Raw birth fields, private questions, follow-ups, and optional comments are sensitive. They are encrypted with AES-256-GCM before persistence; the 32-byte key is supplied only through managed runtime secrets. The envelope includes a version, random 96-bit nonce, authentication tag, and ciphertext. Tampering is rejected.

All user-owned Postgres tables enable Row-Level Security and compare `user_id` with the authenticated JWT subject. Service-role access is reserved for narrow server and job boundaries and must emit an audit event. Production verification requires Supabase credentials and cross-user integration tests.

AI payloads contain the locked draw, curated meanings, the question, and only question-relevant plain-language traits. They exclude birth name, birth date/time/place, email, and raw calculation payloads. Analytics and error events may contain IDs, categories, lengths, statuses, and latency, never raw profile or question content.

Deletion revokes access immediately and later runs durable removal across profiles, readings, reports, storage, and configured backups. Payment instruments remain at Stripe. Key rotation, backup restore, retention periods, incident response, rate limits, production telemetry sampling, and provider no-retention settings remain launch gates.
