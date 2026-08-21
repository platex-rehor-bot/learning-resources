import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Content,
  DataList,
  DataListCell,
  DataListItem,
  DataListItemCells,
  DataListItemRow,
  SearchInput,
  Spinner,
} from '@patternfly/react-core';
import {
  UseFieldApiConfig,
  useFieldApi,
  useFormApi,
} from '@data-driven-forms/react-form-renderer';
import YAML from 'yaml';
import {
  RepoQuickstartEntry,
  getRepoQuickstartContent,
  listRepoQuickstarts,
} from '../../utils/createQuickstartPR';
import {
  NAME_BUNDLES,
  NAME_DESCRIPTION,
  NAME_DURATION,
  NAME_ICON,
  NAME_KIND,
  NAME_METADATA_NAME,
  NAME_PANEL_INTRODUCTION,
  NAME_PREREQUISITES,
  NAME_TAGS,
  NAME_TASKS_ARRAY,
  NAME_TASK_TITLES,
  NAME_TITLE,
  NAME_URL,
} from './steps/common';
import { ALL_KIND_ENTRIES, ItemKind } from './meta';

const SOURCE_SCRATCH = '__scratch__';

const normalizeKindLabel = (value: string) =>
  value.toLowerCase().replace(/\s+/g, '');

function detectKindFromSpec(
  spec: Record<string, unknown> | undefined
): ItemKind | null {
  const typeObj = spec?.type as Record<string, unknown> | undefined;
  const typeText = typeObj?.text;
  if (typeof typeText !== 'string') return null;
  for (const [kind, meta] of ALL_KIND_ENTRIES) {
    if (normalizeKindLabel(meta.displayName) === normalizeKindLabel(typeText)) {
      return kind;
    }
  }
  return null;
}

const SourceSelector = (props: UseFieldApiConfig) => {
  const { input } = useFieldApi(props);
  const formApi = useFormApi();

  const [quickstarts, setQuickstarts] = useState<RepoQuickstartEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loadingName, setLoadingName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await listRepoQuickstarts();
        if (!cancelled) setQuickstarts(entries);
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load quickstarts'
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.toLowerCase();
    return quickstarts.filter(
      (qs) =>
        (qs.name ?? '').toLowerCase().includes(needle) ||
        (qs.displayName ?? '').toLowerCase().includes(needle)
    );
  }, [quickstarts, search]);

  const clearQuickstartFields = () => {
    formApi.change(NAME_KIND, undefined);
    formApi.change(NAME_METADATA_NAME, undefined);
    formApi.change(NAME_TITLE, undefined);
    formApi.change(NAME_DESCRIPTION, undefined);
    formApi.change(NAME_DURATION, undefined);
    formApi.change(NAME_URL, undefined);
    formApi.change(NAME_BUNDLES, undefined);
    formApi.change(NAME_TAGS, undefined);
    formApi.change(NAME_PREREQUISITES, undefined);
    formApi.change(NAME_PANEL_INTRODUCTION, undefined);
    formApi.change(NAME_TASK_TITLES, undefined);
    formApi.change(NAME_TASKS_ARRAY, undefined);
    formApi.change(NAME_ICON, undefined);
  };

  const handleSelectScratch = () => {
    input.onChange(SOURCE_SCRATCH);
    clearQuickstartFields();
  };

  const handleSelectRepo = async (name: string) => {
    setLoadingName(name);
    input.onChange(name);
    setError(null);
    clearQuickstartFields();
    try {
      const content = await getRepoQuickstartContent(name);
      const yamlFile = content.files.find(
        (f) =>
          (f.name.endsWith('.yml') || f.name.endsWith('.yaml')) &&
          !f.name.startsWith('metadata.')
      );
      if (!yamlFile) {
        setError(`No quickstart YAML file found in "${name}".`);
        return;
      }

      const parsed = YAML.parse(yamlFile.content);
      if (!parsed) {
        setError(`The quickstart YAML in "${name}" is empty or not valid.`);
        return;
      }

      const spec = parsed.spec || {};
      const metadata = parsed.metadata || {};

      if (metadata.name) formApi.change(NAME_METADATA_NAME, metadata.name);

      const detectedKind = detectKindFromSpec(spec);
      if (detectedKind) {
        formApi.change(NAME_KIND, detectedKind);
      }

      if (spec.displayName) formApi.change(NAME_TITLE, spec.displayName);
      if (spec.description) formApi.change(NAME_DESCRIPTION, spec.description);
      if (spec.icon !== undefined) formApi.change(NAME_ICON, spec.icon);
      if (spec.durationMinutes !== undefined)
        formApi.change(NAME_DURATION, spec.durationMinutes);
      if (spec.link?.href) formApi.change(NAME_URL, spec.link.href);
      if (spec.prerequisites)
        formApi.change(NAME_PREREQUISITES, spec.prerequisites);
      if (spec.introduction)
        formApi.change(NAME_PANEL_INTRODUCTION, spec.introduction);

      if (spec.tasks && Array.isArray(spec.tasks)) {
        formApi.change(
          NAME_TASK_TITLES,
          spec.tasks.map((t: { title?: string }) => t.title || '')
        );
        formApi.change(
          NAME_TASKS_ARRAY,
          spec.tasks.map(
            (t: {
              description?: string;
              review?: {
                instructions?: string;
                failedTaskHelp?: string;
              };
            }) => ({
              description: t.description,
              enable_work_check: !!t.review,
              work_check_instructions: t.review?.instructions,
              work_check_help: t.review?.failedTaskHelp,
            })
          )
        );
      }

      const bundles: string[] = [];
      const tagsByKind: { [kind: string]: string[] } = {};
      const metadataFile = content.files.find((f) =>
        f.name.startsWith('metadata.')
      );
      if (metadataFile) {
        const meta = YAML.parse(metadataFile.content);
        if (Array.isArray(meta?.tags)) {
          meta.tags.forEach((tag: { kind?: string; value?: string }) => {
            if (tag.kind === 'bundle' && tag.value) {
              bundles.push(tag.value);
            } else if (tag.kind && tag.value) {
              if (!tagsByKind[tag.kind]) tagsByKind[tag.kind] = [];
              tagsByKind[tag.kind].push(tag.value);
            }
          });
        }
      }
      if (bundles.length > 0) formApi.change(NAME_BUNDLES, bundles);
      if (Object.keys(tagsByKind).length > 0)
        formApi.change(NAME_TAGS, tagsByKind);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load quickstart'
      );
    } finally {
      setLoadingName(null);
    }
  };

  const selected = input.value;

  return (
    <div>
      <div className="pf-v6-c-form__group">
        <Content component="p">
          Start from scratch or load an existing quickstart from the repository.
        </Content>
      </div>
      <div className="pf-v6-c-form__group">
        <label className="pf-v6-c-form__label">
          <span className="pf-v6-c-form__label-text">Select source</span>
          <span className="pf-v6-c-form__label-required" aria-hidden="true">
            {' '}
            *
          </span>
        </label>
        <div className="pf-v6-c-form__group-control">
          <SearchInput
            placeholder="Search quickstarts..."
            value={search}
            onChange={(_event, value) => setSearch(value)}
            onClear={() => setSearch('')}
            className="pf-v6-u-mb-sm"
          />

          {loading && <Spinner size="lg" className="pf-v6-u-mt-md" />}

          {error && (
            <Alert
              variant="danger"
              title="Error"
              isInline
              className="pf-v6-u-mt-md"
            >
              {error}
            </Alert>
          )}

          {!loading && !error && (
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <DataList aria-label="Source selection" isCompact>
                <DataListItem
                  key="scratch"
                  aria-labelledby="source-scratch"
                  className={selected === SOURCE_SCRATCH ? 'pf-m-selected' : ''}
                >
                  <DataListItemRow>
                    <DataListItemCells
                      dataListCells={[
                        <DataListCell key="name">
                          <button
                            id="source-scratch"
                            type="button"
                            className={`pf-v6-c-button pf-m-link pf-m-inline${
                              selected === SOURCE_SCRATCH ? ' pf-m-current' : ''
                            }`}
                            onClick={handleSelectScratch}
                            style={{
                              fontWeight:
                                selected === SOURCE_SCRATCH ? 700 : 400,
                            }}
                          >
                            Start from scratch
                          </button>
                        </DataListCell>,
                      ]}
                    />
                  </DataListItemRow>
                </DataListItem>
                {filtered.map((qs) => (
                  <DataListItem
                    key={qs.name}
                    aria-labelledby={`source-${qs.name}`}
                    className={selected === qs.name ? 'pf-m-selected' : ''}
                  >
                    <DataListItemRow>
                      <DataListItemCells
                        dataListCells={[
                          <DataListCell key="name">
                            <button
                              id={`source-${qs.name}`}
                              type="button"
                              className={`pf-v6-c-button pf-m-link pf-m-inline${
                                selected === qs.name ? ' pf-m-current' : ''
                              }`}
                              onClick={() => handleSelectRepo(qs.name)}
                              disabled={loadingName !== null}
                              style={{
                                fontWeight: selected === qs.name ? 700 : 400,
                              }}
                            >
                              {qs.displayName || qs.name}
                              {loadingName === qs.name && (
                                <Spinner size="sm" className="pf-v6-u-ml-sm" />
                              )}
                            </button>
                          </DataListCell>,
                        ]}
                      />
                    </DataListItemRow>
                  </DataListItem>
                ))}
                {filtered.length === 0 && quickstarts.length > 0 && (
                  <DataListItem key="empty">
                    <DataListItemRow>
                      <DataListItemCells
                        dataListCells={[
                          <DataListCell key="empty-msg">
                            No quickstarts found
                          </DataListCell>,
                        ]}
                      />
                    </DataListItemRow>
                  </DataListItem>
                )}
              </DataList>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SourceSelector;
