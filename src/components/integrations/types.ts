export interface FieldOption {
  value: string;
  instruction: string;
}

export interface KommoCustomField {
  id: string;
  name: string;
  fieldKey: string;
  dataType: string;
  selected: boolean;
  description: string;
  options?: FieldOption[];
}

export interface KommoPipelineStage {
  id: string;
  name: string;
  pipelineId: string;
  pipelineName: string;
  selected: boolean;
  description: string;
}

export interface KommoUserOption {
  ghl_id: string;
  name: string;
}

export interface KommoSync {
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  leads_count?: number | null;
}
