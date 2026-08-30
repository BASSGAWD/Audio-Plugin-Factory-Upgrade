import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const organizationRoleEnum = pgEnum("organization_role", [
  "owner",
  "admin",
  "engineer",
  "reviewer",
  "viewer",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "archived",
]);

export const pluginVersionStateEnum = pgEnum("plugin_version_state", [
  "draft",
  "benchmarked",
  "approved",
  "release_candidate",
  "released",
  "archived",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);

export const artifactKindEnum = pgEnum("artifact_kind", [
  "faust",
  "juce_cpp",
  "vst3",
  "au",
  "aax",
  "report",
  "preset_pack",
]);

export const benchmarkStatusEnum = pgEnum("benchmark_status", [
  "passed",
  "failed",
  "warning",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const organizationsTable = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  plan: text("plan").notNull().default("team"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => ({
  slugIdx: uniqueIndex("organizations_slug_idx").on(table.slug),
}));

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => ({
  externalIdIdx: uniqueIndex("users_external_id_idx").on(table.externalId),
  emailIdx: uniqueIndex("users_email_idx").on(table.email),
}));

export const organizationMembersTable = pgTable("organization_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: organizationRoleEnum("role").notNull().default("viewer"),
  ...timestamps,
}, (table) => ({
  membershipIdx: uniqueIndex("organization_members_org_user_idx").on(table.organizationId, table.userId),
  orgIdx: index("organization_members_org_idx").on(table.organizationId),
}));

export const projectsTable = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: projectStatusEnum("status").notNull().default("active"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => ({
  orgIdx: index("projects_org_idx").on(table.organizationId),
}));

export const pluginsTable = pgTable("plugins", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  currentVersionId: uuid("current_version_id"),
  ...timestamps,
}, (table) => ({
  orgIdx: index("plugins_org_idx").on(table.organizationId),
  projectIdx: index("plugins_project_idx").on(table.projectId),
}));

export const pluginVersionsTable = pgTable("plugin_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  pluginId: uuid("plugin_id").notNull().references(() => pluginsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  state: pluginVersionStateEnum("state").notNull().default("draft"),
  prompt: text("prompt").notNull(),
  modelProvider: text("model_provider"),
  modelName: text("model_name"),
  dspSource: text("dsp_source").notNull(),
  uiContract: jsonb("ui_contract").$type<Record<string, unknown>>().notNull().default({}),
  parameterContract: jsonb("parameter_contract").$type<Record<string, unknown>[]>().notNull().default([]),
  qualitySummary: jsonb("quality_summary").$type<Record<string, unknown>>().notNull().default({}),
  approvedByUserId: uuid("approved_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  ...timestamps,
}, (table) => ({
  pluginVersionIdx: uniqueIndex("plugin_versions_plugin_version_idx").on(table.pluginId, table.version),
  orgIdx: index("plugin_versions_org_idx").on(table.organizationId),
}));

export const generationJobsTable = pgTable("generation_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  pluginVersionId: uuid("plugin_version_id").references(() => pluginVersionsTable.id, { onDelete: "set null" }),
  requestedByUserId: uuid("requested_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: jobStatusEnum("status").notNull().default("queued"),
  prompt: text("prompt").notNull(),
  provider: text("provider"),
  model: text("model"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => ({
  orgStatusIdx: index("generation_jobs_org_status_idx").on(table.organizationId, table.status),
}));

export const benchmarkReportsTable = pgTable("benchmark_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  pluginVersionId: uuid("plugin_version_id").notNull().references(() => pluginVersionsTable.id, { onDelete: "cascade" }),
  status: benchmarkStatusEnum("status").notNull(),
  score: integer("score").notNull(),
  latencyMs: numeric("latency_ms", { precision: 8, scale: 3 }),
  cpuPercent: numeric("cpu_percent", { precision: 8, scale: 3 }),
  peakDbfs: numeric("peak_dbfs", { precision: 8, scale: 3 }),
  dcOffset: numeric("dc_offset", { precision: 12, scale: 9 }),
  findings: jsonb("findings").$type<Record<string, unknown>[]>().notNull().default([]),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => ({
  versionIdx: index("benchmark_reports_version_idx").on(table.pluginVersionId),
  orgIdx: index("benchmark_reports_org_idx").on(table.organizationId),
}));

export const buildArtifactsTable = pgTable("build_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  pluginVersionId: uuid("plugin_version_id").notNull().references(() => pluginVersionsTable.id, { onDelete: "cascade" }),
  kind: artifactKindEnum("kind").notNull(),
  storageUrl: text("storage_url").notNull(),
  checksumSha256: text("checksum_sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  signed: boolean("signed").notNull().default(false),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => ({
  versionIdx: index("build_artifacts_version_idx").on(table.pluginVersionId),
  orgIdx: index("build_artifacts_org_idx").on(table.organizationId),
}));

export const auditEventsTable = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgCreatedIdx: index("audit_events_org_created_idx").on(table.organizationId, table.createdAt),
}));

export const usageRecordsTable = pgTable("usage_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  metric: text("metric").notNull(),
  quantity: integer("quantity").notNull(),
  unit: text("unit").notNull(),
  sourceId: uuid("source_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgMetricIdx: index("usage_records_org_metric_idx").on(table.organizationId, table.metric),
}));

export const organizationsRelations = relations(organizationsTable, ({ many }) => ({
  members: many(organizationMembersTable),
  projects: many(projectsTable),
  plugins: many(pluginsTable),
}));

export const usersRelations = relations(usersTable, ({ many }) => ({
  memberships: many(organizationMembersTable),
  approvedVersions: many(pluginVersionsTable),
}));

export const projectsRelations = relations(projectsTable, ({ one, many }) => ({
  organization: one(organizationsTable, { fields: [projectsTable.organizationId], references: [organizationsTable.id] }),
  plugins: many(pluginsTable),
}));

export const pluginsRelations = relations(pluginsTable, ({ one, many }) => ({
  organization: one(organizationsTable, { fields: [pluginsTable.organizationId], references: [organizationsTable.id] }),
  project: one(projectsTable, { fields: [pluginsTable.projectId], references: [projectsTable.id] }),
  versions: many(pluginVersionsTable),
}));

export const pluginVersionsRelations = relations(pluginVersionsTable, ({ one, many }) => ({
  organization: one(organizationsTable, { fields: [pluginVersionsTable.organizationId], references: [organizationsTable.id] }),
  plugin: one(pluginsTable, { fields: [pluginVersionsTable.pluginId], references: [pluginsTable.id] }),
  approvedBy: one(usersTable, { fields: [pluginVersionsTable.approvedByUserId], references: [usersTable.id] }),
  benchmarkReports: many(benchmarkReportsTable),
  buildArtifacts: many(buildArtifactsTable),
}));

export const insertOrganizationSchema = createInsertSchema(organizationsTable);
export const selectOrganizationSchema = createSelectSchema(organizationsTable);
export const insertUserSchema = createInsertSchema(usersTable);
export const selectUserSchema = createSelectSchema(usersTable);
export const insertProjectSchema = createInsertSchema(projectsTable);
export const selectProjectSchema = createSelectSchema(projectsTable);
export const insertPluginSchema = createInsertSchema(pluginsTable);
export const selectPluginSchema = createSelectSchema(pluginsTable);
export const insertPluginVersionSchema = createInsertSchema(pluginVersionsTable);
export const selectPluginVersionSchema = createSelectSchema(pluginVersionsTable);
export const insertGenerationJobSchema = createInsertSchema(generationJobsTable);
export const selectGenerationJobSchema = createSelectSchema(generationJobsTable);
export const insertBenchmarkReportSchema = createInsertSchema(benchmarkReportsTable).extend({
  score: z.number().int().min(0).max(100),
});
export const selectBenchmarkReportSchema = createSelectSchema(benchmarkReportsTable);
export const insertBuildArtifactSchema = createInsertSchema(buildArtifactsTable);
export const selectBuildArtifactSchema = createSelectSchema(buildArtifactsTable);
