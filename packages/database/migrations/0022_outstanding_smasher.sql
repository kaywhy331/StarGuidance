ALTER TABLE "product_events" DROP CONSTRAINT "product_events_name";--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_name" CHECK ("product_events"."event_name" in (
        'landing_view', 'pricing_view', 'signup_started', 'consent_completed',
        'profile_started', 'profile_completed', 'reading_selected', 'question_submitted',
        'shuffle_started', 'draw_locked', 'card_revealed', 'result_viewed',
        'followup_submitted', 'feedback_submitted', 'reading_reopened',
        'outcome_invited', 'outcome_submitted', 'report_previewed', 'checkout_started',
        'purchase_completed', 'report_ready', 'report_viewed', 'auth_failed',
        'profile_failed', 'generation_completed', 'generation_failed', 'fallback_used',
        'payment_failed', 'job_retried'
      ));