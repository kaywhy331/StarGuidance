ALTER TABLE "product_events" ADD CONSTRAINT "product_events_digest" CHECK ("product_events"."idempotency_key" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_name" CHECK ("product_events"."event_name" in (
        'landing_view', 'pricing_view', 'signup_started', 'consent_completed',
        'profile_started', 'profile_completed', 'reading_selected', 'question_submitted',
        'shuffle_started', 'draw_locked', 'card_revealed', 'result_viewed',
        'followup_submitted', 'feedback_submitted', 'reading_reopened',
        'outcome_invited', 'outcome_submitted', 'report_previewed', 'checkout_started',
        'purchase_completed', 'report_ready', 'report_viewed', 'profile_failed',
        'generation_failed', 'fallback_used', 'payment_failed', 'job_retried'
      ));--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_properties_object" CHECK (jsonb_typeof("product_events"."properties") = 'object');--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_property_vocabulary" CHECK ("product_events"."properties" - array[
        'routeClass', 'referrerClass', 'deviceClass', 'locale', 'completeness',
        'birthplacePresent', 'birthTimePresent', 'spreadId', 'spreadVersion', 'cardCount',
        'topic', 'horizon', 'questionLength', 'generalReading', 'generationMode',
        'fallbackUsed', 'feedbackKind', 'outcomeStatus', 'behaviorChanged', 'ratingBand',
        'readingAgeBucket', 'productId', 'priceId', 'campaignClass', 'modelVersion',
        'provider', 'currency', 'priceMinor', 'statusClass', 'errorClass', 'durationBucket'
      ]::text[] = '{}'::jsonb);--> statement-breakpoint
ALTER TABLE "reading_feedback" ADD CONSTRAINT "reading_feedback_rating_range" CHECK (("reading_feedback"."resonance" is null or "reading_feedback"."resonance" between 1 and 5)
        and ("reading_feedback"."helpfulness" is null or "reading_feedback"."helpfulness" between 1 and 5));--> statement-breakpoint
ALTER TABLE "reading_feedback" ADD CONSTRAINT "reading_feedback_kind_contract" CHECK ((
        "reading_feedback"."kind" = 'experience'
        and "reading_feedback"."outcome_status" is null
        and "reading_feedback"."behavior_changed" is null
        and ("reading_feedback"."resonance" is not null or "reading_feedback"."helpfulness" is not null or "reading_feedback"."encrypted_comment" is not null)
      ) or (
        "reading_feedback"."kind" = 'outcome'
        and "reading_feedback"."outcome_status" in ('occurred', 'partial', 'did_not_occur', 'unclear')
        and "reading_feedback"."behavior_changed" is not null
        and "reading_feedback"."resonance" is null
        and "reading_feedback"."helpfulness" is null
      ));