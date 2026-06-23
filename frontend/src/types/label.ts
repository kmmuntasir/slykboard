// F14 T5: project-scoped color-coded label catalog type + DTOs.

export interface Label {
  id: string;
  name: string;
  color: string; // normalized #RRGGBB uppercase
}

export interface CreateLabelDto {
  name: string;
  color: string;
}

export interface UpdateLabelDto {
  name?: string;
  color?: string;
}
