/**
 * Shared UI component library barrel. Pages import from "@/components/ui".
 * All components are presentational + prop-driven; they consume the CSS tokens
 * from globals.css (B0) and the typed maps in @/lib/visual-tokens.
 */

export { Card, Panel } from "./card";
export type { CardVariant } from "./card";

export { Button, TrackButton, ConfirmButton } from "./button";
export type { ButtonVariant, ButtonSize } from "./button";

export { Badge, TierBadge, ResultBadge, StatusBadge } from "./badge";

export { StatCell, StatGroup } from "./stat-cell";

export { SemanticValue } from "./semantic-value";

export { Bar, LabeledBar } from "./bar";

export { FairChip } from "./fair-chip";
export { OddsTable, OddsValue, fmtAmerican } from "./odds-row";
export type { OddsRowItem } from "./odds-row";

export { SectionHeader } from "./section-header";

export { EmptyState, ErrorBanner, Skeleton, SkeletonText, SkeletonCard, Loading } from "./states";

export { Accruing, SampleSize } from "./accruing";

export { DataTable } from "./data-table";
export type { Column } from "./data-table";

export { DateNav, DateField, offsetDate } from "./date-nav";
export { NumberField } from "./number-field";
export { TeamLogo } from "./team-logo";

export { Dialog } from "./dialog";
export { Markdown } from "./markdown";

export { Tabs, TabPanel } from "./tabs";
export type { TabItem } from "./tabs";
