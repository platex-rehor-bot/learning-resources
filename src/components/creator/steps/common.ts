import { validatorTypes } from '@data-driven-forms/react-form-renderer';

export const REQUIRED = {
  type: validatorTypes.REQUIRED,
} as const;

export const NAME_KIND = 'kind';
export const NAME_METADATA_NAME = 'metadata-name';
export const NAME_TAGS = 'tags';
export const NAME_TITLE = 'title';
export const NAME_BUNDLES = 'bundles';
export const NAME_DESCRIPTION = 'description';
export const NAME_DURATION = 'duration';
export const NAME_URL = 'url';
export const NAME_ICON = 'icon';

export const NAME_PANEL_INTRODUCTION = 'panel-overview';
export const NAME_PREREQUISITES = 'prerequisites';

export const NAME_TASKS_ARRAY = 'tasks';
export const NAME_TASK_TITLES = 'task-titles';

export const NAME_TASK_DESCRIPTION = 'description';
export const NAME_TASK_ENABLE_WORK_CHECK = 'enable_work_check';
export const NAME_TASK_WORK_CHECK_INSTRUCTIONS = 'work_check_instructions';
export const NAME_TASK_WORK_CHECK_HELP = 'work_check_help';

export const MAX_TASKS = 10;
