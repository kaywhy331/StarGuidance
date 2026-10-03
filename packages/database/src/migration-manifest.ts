/**
 * Ordered authoritative migration history.
 *
 * Staging verification and integrity tests share this manifest so adding a
 * migration cannot update one gate while silently leaving the other behind.
 */
export const EXPECTED_MIGRATIONS = [
  "0000_busy_centennial",
  "0001_supabase_staging",
  "0002_remove_auth_user_sync_trigger",
  "0003_webhook_replay_lease",
  "0004_server_actor_role",
  "0005_bumpy_moon_knight",
  "0006_rate_limit_buckets",
  "0007_interpretation_jobs",
  "0008_interpretation_jobs_subject_rls",
  "0009_profile_snapshot_immutability",
  "0010_deletion_receipts",
  "0011_reading_flow_controls",
  "0012_commerce_report_jobs",
  "0013_checkout_report_source",
  "0014_account_consent_settings",
  "0015_consent_event_history",
  "0016_reading_intake_recovery",
  "0017_sound-on-by-default",
  "0018_reading_outcome_feedback",
  "0019_privacy_safe_product_events",
  "0020_wonderful_thunderball",
  "0021_optimal_frightful_four",
  "0022_outstanding_smasher",
  "0023_output_provenance",
  "0024_immutable_content_versions",
  "0025_committed_draw_lifecycle",
  "0026_relationship_profiles",
  "0027_guest_reading_history",
  "0028_follow_up_reading_owner",
  "0029_browser_role_privilege_boundary",
] as const;

/**
 * Drizzle records each applied migration as the SHA-256 of its SQL file and the
 * journal `when` as `created_at`. Pinning both lets verification prove that a
 * database ran this exact history, not merely the same number of migrations.
 */
export const EXPECTED_MIGRATION_LINEAGE: readonly {
  readonly tag: string;
  readonly createdAt: number;
  readonly sha256: string;
}[] = [
  {
    tag: "0000_busy_centennial",
    createdAt: 1784780558798,
    sha256: "fea39ca2ff2c3ccbf425adeaea261de6c9a05eeed7cf16665516da03630871cb",
  },
  {
    tag: "0001_supabase_staging",
    createdAt: 1784824560072,
    sha256: "c3d16aaa2337cde908ec42da0c73ef3287d3cb3cf83c78822d64972cca678727",
  },
  {
    tag: "0002_remove_auth_user_sync_trigger",
    createdAt: 1785709399728,
    sha256: "f5148ce8cdaaacaede22250f916b0fd9c2c18e116da147adea6398d160452f32",
  },
  {
    tag: "0003_webhook_replay_lease",
    createdAt: 1785865302892,
    sha256: "ba0cfa16d9a3256e98c43d2a62b6b5e6cad5bcae328ccec0a61f45088f62b9f9",
  },
  {
    tag: "0004_server_actor_role",
    createdAt: 1785866265679,
    sha256: "32dd231cbe55ef316ef71896b1fc9f11af1772c4fdc0722cd58efc3b2fa76aad",
  },
  {
    tag: "0005_bumpy_moon_knight",
    createdAt: 1785985991643,
    sha256: "e63e5b2af79a8b635292feffe0441a18f22a28fa4700dc1bc58d010a6fc4b794",
  },
  {
    tag: "0006_rate_limit_buckets",
    createdAt: 1786041275302,
    sha256: "c4f29725cc7ba2e54f77a24b585e4cb8e596262cbe03b184b7f8dfbe635141c8",
  },
  {
    tag: "0007_interpretation_jobs",
    createdAt: 1786044815068,
    sha256: "ca141a5257796e0e3c23caba1413cf8bb606fcb499eb39c5d94655c5831e4bee",
  },
  {
    tag: "0008_interpretation_jobs_subject_rls",
    createdAt: 1786139113506,
    sha256: "d5aecc953a81ec0a4a42b4876593248969144d53f3099ccdcc89f5a413340557",
  },
  {
    tag: "0009_profile_snapshot_immutability",
    createdAt: 1786139113507,
    sha256: "d228d35758f7bd7fa722cc2e95572a7cadca3570ed93b584db768c1420291bf4",
  },
  {
    tag: "0010_deletion_receipts",
    createdAt: 1786139931822,
    sha256: "c493ef6415cfbbf7625a17654f46303494c7bf25c219bb76713144f571fe9178",
  },
  {
    tag: "0011_reading_flow_controls",
    createdAt: 1786382374230,
    sha256: "07de96da150bacd6f3e028165508ddcc4d94c49b420fc5d5985f303b4f54c823",
  },
  {
    tag: "0012_commerce_report_jobs",
    createdAt: 1786386068435,
    sha256: "ae71077d80d026d3cd14738521908d4aa4499b3dd2a30517adbfd8f6d115f8ff",
  },
  {
    tag: "0013_checkout_report_source",
    createdAt: 1786386856382,
    sha256: "94c13c7badf5be7b7ebd86111c2c8970e724ffa15968104fd5771d60e9e0b54d",
  },
  {
    tag: "0014_account_consent_settings",
    createdAt: 1786390769817,
    sha256: "79dab4d38987a7d32b807760a25d3e06d09f4a33fcebcd98ff965744737c277c",
  },
  {
    tag: "0015_consent_event_history",
    createdAt: 1786477669061,
    sha256: "826a4e1a4f186f96640ad661df47b7c6d7fce9ea8d3dd5a42d126b80f19a9b16",
  },
  {
    tag: "0016_reading_intake_recovery",
    createdAt: 1786478312181,
    sha256: "783c256a90a1a8500a31ef9c12b83fd9e4020891fc612a99e2e374ed0fb8d1b6",
  },
  {
    tag: "0017_sound-on-by-default",
    createdAt: 1786820266940,
    sha256: "3d3b98ed3d8215be7826057b853d7f006641871ded256200850247844f8d5565",
  },
  {
    tag: "0018_reading_outcome_feedback",
    createdAt: 1787259982751,
    sha256: "ffa50fe9f19250b00dcb632b2f11ebd9a65b4d38eecc19346b658a4e6d315c60",
  },
  {
    tag: "0019_privacy_safe_product_events",
    createdAt: 1787261089154,
    sha256: "4f4cf3fb0b1aa3d8d3e7bcf92d721145615d6099ba7385b082770765813cdb6a",
  },
  {
    tag: "0020_wonderful_thunderball",
    createdAt: 1787261949375,
    sha256: "c6478e72b5ac0b11694122ec6b7e5e120519a1f94f75e50741f2ddf4b19815dc",
  },
  {
    tag: "0021_optimal_frightful_four",
    createdAt: 1787262346897,
    sha256: "620be686d4a1602b6f449ac0fa3dfb9cbca06d9d27e395dd4db420c0a5951aef",
  },
  {
    tag: "0022_outstanding_smasher",
    createdAt: 1787264609961,
    sha256: "e3bbebde9605b48ae7829834b278273775aaddc6f78f0074ca30cfb1c360cdf4",
  },
  {
    tag: "0023_output_provenance",
    createdAt: 1787267273381,
    sha256: "238cc827f006c73a66326b726d31b0f4df8f419c8ce8ae1334f53e0994b182a0",
  },
  {
    tag: "0024_immutable_content_versions",
    createdAt: 1787328147729,
    sha256: "bee71d381cd1a2206d428841f9d795fbe7e2c8cf8833a50e2e4c78c5f5ce452e",
  },
  {
    tag: "0025_committed_draw_lifecycle",
    createdAt: 1787449969989,
    sha256: "cfd7055877f764cf098108223c977b8f9658076e7b67bc9da08c93ec669bbb8c",
  },
  {
    tag: "0026_relationship_profiles",
    createdAt: 1787760105929,
    sha256: "bf9c00a7e1b1e2446425bc499ff506b828d142efe3b6495a1efa7e0b5c01d557",
  },
  {
    tag: "0027_guest_reading_history",
    createdAt: 1790777950323,
    sha256: "a54449316d37318a677e13a57c9fbb598f8404961492d334856790b43b46b63c",
  },
  {
    tag: "0028_follow_up_reading_owner",
    createdAt: 1790995102558,
    sha256: "8417cf1a5e77841223000b2888c2de3f74cdbe1273bec13896c770a274395833",
  },
  {
    tag: "0029_browser_role_privilege_boundary",
    createdAt: 1791043200000,
    sha256: "fb2e43b1a85bf2d0dfd95d63e8f8139e2b460b85313b20a771ac1464dbe64cfb",
  },
];
