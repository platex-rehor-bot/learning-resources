import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Button,
  DataList,
  DataListCell,
  DataListItem,
  DataListItemCells,
  DataListItemRow,
  Divider,
  Flex,
  FlexItem,
  FormGroup,
  Label,
  List,
  ListItem,
  MenuToggle,
  MenuToggleElement,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  SearchInput,
  Select,
  SelectGroup,
  SelectList,
  SelectOption,
  Spinner,
  Tooltip,
} from '@patternfly/react-core';
import {
  CodeBranchIcon,
  DownloadIcon,
  FileImportIcon,
  UploadIcon,
} from '@patternfly/react-icons';
import {
  RepoQuickstartEntry,
  getRepoQuickstartContent,
  listRepoQuickstarts,
} from '../../utils/createQuickstartPR';
import Editor from '@monaco-editor/react';
import YAML from 'yaml';
import { QuickStartSpec } from '@patternfly/quickstarts';
import { downloadFile } from '@redhat-cloud-services/frontend-components-utilities/helpers';
import { ExtendedQuickstart } from '../../utils/fetchQuickstarts';
import { CreatorWizardContext } from './context';
import { useCreatePR } from './useCreatePR';
import { ALL_KIND_ENTRIES, ItemKind } from './meta';
import { FilterData } from '../../utils/FiltersCategoryInterface';
import { useFlag } from '@unleash/proxy-client-react';
import CreatePRModal from './CreatePRModal';
import './CreatorYAMLView.scss';
import { DEFAULT_QUICKSTART_YAML } from '../../data/quickstart-templates';

const PLACEHOLDER_YAML =
  '# YAML Quickstart Definition\n# Start typing or paste your YAML here\n';

const isUserContent = (content: string): boolean => {
  const trimmed = content.trim();
  return trimmed !== '' && content !== PLACEHOLDER_YAML;
};

const normalizeKindLabel = (value: string) =>
  value.toLowerCase().replace(/\s+/g, '');

/**
 * Detect ItemKind from spec.type.text by matching against known display names.
 * Normalizes whitespace so "Quick start" matches "Quickstart", etc.
 */
function detectKind(
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

type ValidationWarning = { field: string; message: string };

const VALID_TAG_KINDS = new Set([
  'bundle',
  'content',
  'use-case',
  'product-families',
]);

const VALID_SPEC_FIELDS = new Set([
  'displayName',
  'description',
  'icon',
  'type',
  'durationMinutes',
  'link',
  'prerequisites',
  'introduction',
  'tasks',
  'version',
]);

/**
 * Validate parsed YAML against the QuickStart schema.
 * Returns an array of warnings (non-blocking).
 */
function validateQuickstartYaml(
  parsed: Record<string, unknown>
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const metadata = parsed.metadata as Record<string, unknown> | undefined;
  const spec = parsed.spec as Record<string, unknown> | undefined;

  if (!metadata?.name) {
    warnings.push({
      field: 'metadata.name',
      message: 'Required — used as file name and identifier',
    });
  }

  if (!spec?.displayName) {
    warnings.push({
      field: 'spec.displayName',
      message: 'Required — title shown on the card',
    });
  }

  if (!spec?.description) {
    warnings.push({
      field: 'spec.description',
      message: 'Required — card description text',
    });
  }

  // Validate tag kinds
  if (metadata && Array.isArray(metadata.tags)) {
    (metadata.tags as Array<{ kind?: string; value?: string }>).forEach(
      (tag, i) => {
        if (tag.kind && !VALID_TAG_KINDS.has(tag.kind)) {
          warnings.push({
            field: `metadata.tags[${i}].kind`,
            message: `Unknown tag kind "${tag.kind}". Supported: ${[
              ...VALID_TAG_KINDS,
            ].join(', ')}`,
          });
        }
        if (!tag.value) {
          warnings.push({
            field: `metadata.tags[${i}].value`,
            message: 'Tag value is required',
          });
        }
      }
    );
  }

  // Validate spec fields
  if (spec) {
    Object.keys(spec).forEach((key) => {
      if (!VALID_SPEC_FIELDS.has(key)) {
        warnings.push({
          field: `spec.${key}`,
          message: `Unknown field — may be ignored`,
        });
      }
    });
  }

  // Validate kind/type
  const kind = detectKind(spec);
  if (spec?.type && !kind) {
    const typeObj = spec.type as Record<string, unknown>;
    warnings.push({
      field: 'spec.type.text',
      message: `Unknown type "${
        typeObj?.text
      }". Supported: ${ALL_KIND_ENTRIES.map(([, m]) => m.displayName).join(
        ', '
      )}`,
    });
  }

  return warnings;
}

/**
 * Serialize current QuickStart state to a YAML string for the editor.
 */
function serializeToYaml(
  quickStart: ExtendedQuickstart,
  bundles: string[],
  tags: { [kind: string]: string[] }
): string {
  const allTags: Array<{ kind: string; value: string }> = bundles
    .toSorted()
    .map((b) => ({ kind: 'bundle', value: b }));
  Object.entries(tags).forEach(([kind, values]) => {
    values.forEach((value) => allTags.push({ kind, value }));
  });

  // Build document matching the expected YAML structure
  const doc: Record<string, unknown> = {
    apiVersion: quickStart.apiVersion || 'console.openshift.io/v1',
    kind: 'QuickStarts',
    metadata: {
      name: quickStart.metadata.name || 'untitled-quickstart',
      ...(quickStart.metadata.externalDocumentation
        ? { externalDocumentation: true }
        : {}),
      ...(quickStart.metadata.learningPath ? { learningPath: true } : {}),
      ...(quickStart.metadata.otherResource ? { otherResource: true } : {}),
      ...(allTags.length > 0 ? { tags: allTags } : {}),
    },
    spec: {
      version: quickStart.spec.version ?? 0.1,
      ...(quickStart.spec.type
        ? {
            type: {
              text: quickStart.spec.type.text,
              color: quickStart.spec.type.color,
            },
          }
        : {}),
      ...(quickStart.spec.displayName
        ? { displayName: quickStart.spec.displayName }
        : {}),
      icon: quickStart.spec.icon ?? null,
      ...(quickStart.spec.description
        ? { description: quickStart.spec.description }
        : {}),
      ...(quickStart.spec.durationMinutes !== undefined
        ? { durationMinutes: quickStart.spec.durationMinutes }
        : {}),
      ...(quickStart.spec.link
        ? {
            link: {
              text: quickStart.spec.link.text,
              href: quickStart.spec.link.href,
            },
          }
        : {}),
      ...(quickStart.spec.prerequisites?.length
        ? { prerequisites: quickStart.spec.prerequisites }
        : {}),
      ...(quickStart.spec.introduction
        ? { introduction: quickStart.spec.introduction }
        : {}),
      ...(quickStart.spec.tasks?.length
        ? { tasks: quickStart.spec.tasks }
        : {}),
    },
  };

  return YAML.stringify(doc, { lineWidth: 0, nullStr: '~' });
}

/** Bundle entry from chrome.getAvailableBundles() */
export type BundleOption = { id: string; title: string };

/* ------------------------------------------------------------------ */
/*  Standalone bundle selector (not DDF-dependent)                    */
/* ------------------------------------------------------------------ */
const BundleSelector = ({
  bundles,
  selected,
  onChange,
}: {
  bundles: BundleOption[];
  selected: string[];
  onChange: (value: string[]) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      onClick={() => setIsOpen((o) => !o)}
      isExpanded={isOpen}
      style={{ width: '100%' } as React.CSSProperties}
    >
      {selected.length > 0 ? `Selected: ${selected.length}` : 'Select bundles'}
    </MenuToggle>
  );

  const handleSelect = (
    _event: unknown,
    value: string | number | undefined
  ) => {
    if (typeof value !== 'string') return;
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange(next);
  };

  return (
    <FormGroup label="Associated bundle(s)">
      <Select
        isOpen={isOpen}
        toggle={toggle}
        onSelect={handleSelect}
        onOpenChange={setIsOpen}
        maxMenuHeight="300px"
      >
        <SelectList>
          {bundles.map((b) => (
            <SelectOption
              key={b.id}
              value={b.id}
              hasCheckbox
              isSelected={selected.includes(b.id)}
            >
              {b.title} ({b.id})
            </SelectOption>
          ))}
        </SelectList>
      </Select>
    </FormGroup>
  );
};

/* ------------------------------------------------------------------ */
/*  Standalone tag selector (not DDF-dependent)                       */
/* ------------------------------------------------------------------ */
const StandaloneTagsSelector = ({
  filterData,
  value,
  onChange,
}: {
  filterData: FilterData;
  value: { [kind: string]: string[] };
  onChange: (value: { [kind: string]: string[] }) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const selectedCount = useMemo(
    () =>
      Object.values(value).reduce<number>((acc, arr) => acc + arr.length, 0),
    [value]
  );

  const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      onClick={() => setIsOpen((o) => !o)}
      isExpanded={isOpen}
      style={{ width: '100%' } as React.CSSProperties}
    >
      {selectedCount > 0 ? `Selected: ${selectedCount}` : 'Select tags'}
    </MenuToggle>
  );

  const handleSelect = (
    _event: unknown,
    item: { kind: string; value: string }
  ) => {
    const next = { ...value };
    if (!next[item.kind]) next[item.kind] = [];
    if (next[item.kind].includes(item.value)) {
      next[item.kind] = next[item.kind].filter((v) => v !== item.value);
    } else {
      next[item.kind] = [...next[item.kind], item.value];
    }
    onChange(next);
  };

  return (
    <FormGroup label="Resource tag(s)">
      <Select
        isOpen={isOpen}
        toggle={toggle}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSelect={handleSelect as any}
        onOpenChange={setIsOpen}
        maxMenuHeight="400px"
      >
        {filterData.categories.map((category, index) =>
          category.categoryData.map((group) => (
            <React.Fragment key={`${category.categoryId}-${group.group}`}>
              <SelectGroup
                label={`${category.categoryName}${
                  group.group ? ` (${group.group})` : ''
                }`}
              >
                <SelectList>
                  {group.data.map((item) => (
                    <SelectOption
                      hasCheckbox
                      isSelected={
                        value[category.categoryId]?.includes(item.id) ?? false
                      }
                      value={{ value: item.id, kind: category.categoryId }}
                      key={item.id}
                    >
                      {item.filterLabel}
                    </SelectOption>
                  ))}
                </SelectList>
              </SelectGroup>
              {index < filterData.categories.length - 1 && (
                <Divider key={`divider-${index}`} />
              )}
            </React.Fragment>
          ))
        )}
      </Select>
    </FormGroup>
  );
};

export type CreatorYAMLViewProps = {
  onChangeQuickStartSpec?: (newValue: QuickStartSpec) => void;
  onChangeBundles?: (newValue: string[]) => void;
  onChangeTags?: (tags: { [kind: string]: string[] }) => void;
  onChangeMetadataTags?: (tags: Array<{ kind: string; value: string }>) => void;
  onChangeKind?: (kind: ItemKind | null) => void;
  quickStart?: ExtendedQuickstart;
  currentBundles?: string[];
  currentTags?: { [kind: string]: string[] };
  filterData?: FilterData;
  bundles?: BundleOption[];
};

const CreatorYAMLView: React.FC<CreatorYAMLViewProps> = ({
  onChangeQuickStartSpec,
  onChangeBundles,
  onChangeTags,
  onChangeMetadataTags,
  onChangeKind,
  quickStart,
  currentBundles,
  currentTags,
  filterData,
  bundles: bundleOptions,
}) => {
  const { files } = useContext(CreatorWizardContext);

  const showCreatePR = useFlag(
    'platform.learning-resources.quickstarts.git-service'
  );

  const [parsedName, setParsedName] = useState<string | null>(null);
  const {
    prLoading,
    prResult,
    prError,
    canCreatePR,
    handleCreatePR,
    setPrResult,
    setPrError,
  } = useCreatePR(parsedName);

  const [prModalOpen, setPrModalOpen] = useState(false);

  const handleOpenPRModal = () => {
    setPrResult(null);
    setPrError(null);
    setPrModalOpen(true);
  };

  const handleClosePRModal = () => {
    setPrModalOpen(false);
  };

  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [repoQuickstarts, setRepoQuickstarts] = useState<RepoQuickstartEntry[]>(
    []
  );
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [repoError, setRepoError] = useState<string | null>(null);

  // On mount, serialize current state to YAML if we have data from the wizard.
  // This enables switching wizard → YAML without losing data.
  const getInitialYaml = (): string => {
    const hasWizardData =
      !!currentBundles?.length ||
      !!Object.keys(currentTags || {}).length ||
      !!quickStart?.spec.displayName ||
      !!quickStart?.spec.description ||
      quickStart?.spec.durationMinutes !== undefined ||
      !!quickStart?.spec.link?.href ||
      !!quickStart?.spec.prerequisites?.length ||
      !!quickStart?.spec.introduction ||
      !!quickStart?.spec.tasks?.length;

    if (quickStart && hasWizardData) {
      return serializeToYaml(
        quickStart,
        currentBundles || [],
        currentTags || {}
      );
    }
    return PLACEHOLDER_YAML;
  };

  const [yamlContent, setYamlContent] = useState<string>(getInitialYaml);
  const [parseError, setParseError] = useState<string | null>(null);
  const [validationWarnings, setValidationWarnings] = useState<
    ValidationWarning[]
  >([]);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Keep a ref to latest yamlContent so the unmount cleanup can flush it
  const yamlContentRef = useRef<string>(yamlContent);
  useEffect(() => {
    yamlContentRef.current = yamlContent;
  }, [yamlContent]);

  // Parse initial YAML on mount so parsedName is set when wizard data is present
  const initialYamlRef = useRef(true);
  useEffect(() => {
    if (initialYamlRef.current && isUserContent(yamlContent)) {
      parseAndUpdateQuickstart(yamlContent);
    }
    initialYamlRef.current = false;
  }, []);

  const configureMonacoEnvironment = () => {
    // Disable Monaco workers to prevent CDN fetching in CI environments
    self.MonacoEnvironment = {
      getWorker() {
        return new Worker(
          URL.createObjectURL(
            new Blob(['self.onmessage = () => {}'], { type: 'text/javascript' })
          )
        );
      },
    };
  };

  const parseAndUpdateQuickstart = (content: string) => {
    try {
      const parsed = YAML.parse(content);

      if (!parsed) {
        setParseError('Empty YAML content');
        setValidationWarnings([]);
        return;
      }

      // Validate structure
      const warnings = validateQuickstartYaml(parsed);
      setValidationWarnings(warnings);

      // Extract metadata
      const metadata = parsed.metadata || {};
      const spec = parsed.spec || {};

      // Build the quickstart object
      const quickstartObj: ExtendedQuickstart = {
        apiVersion: parsed.apiVersion || 'console.openshift.io/v1',
        metadata: {
          name: metadata.name || 'untitled-quickstart',
          tags: metadata.tags || [],
          ...(metadata.externalDocumentation
            ? { externalDocumentation: true }
            : {}),
          ...(metadata.learningPath ? { learningPath: true } : {}),
          ...(metadata.otherResource ? { otherResource: true } : {}),
        },
        spec: {
          version: spec.version ?? 0.1,
          displayName: spec.displayName || '',
          description: spec.description || '',
          icon: spec.icon ?? null,
          type: spec.type,
          durationMinutes: spec.durationMinutes,
          link: spec.link,
          prerequisites: spec.prerequisites,
          introduction: spec.introduction,
          tasks: spec.tasks,
        },
      };

      // Update state
      setParseError(null);

      const name = metadata.name || null;
      if (name !== parsedName) {
        setParsedName(name);
      }

      // Detect and propagate kind from spec.type
      const detectedKind = detectKind(spec);
      if (onChangeKind) {
        onChangeKind(detectedKind);
      }

      // Extract bundles and tags
      const bundles: string[] = [];
      const tagsByKind: { [kind: string]: string[] } = {};

      if (Array.isArray(metadata.tags)) {
        metadata.tags.forEach((tag: { kind?: string; value?: string }) => {
          if (tag.kind === 'bundle' && tag.value) {
            bundles.push(tag.value);
          } else if (tag.kind && tag.value) {
            if (!tagsByKind[tag.kind]) {
              tagsByKind[tag.kind] = [];
            }
            tagsByKind[tag.kind].push(tag.value);
          }
        });
      }

      // Call the callbacks with updated data
      if (onChangeBundles) {
        onChangeBundles(bundles);
      }
      if (onChangeTags) {
        onChangeTags(tagsByKind);
      }
      // Update metadata.tags directly so findQuickstartFilterTags can read them
      if (onChangeMetadataTags) {
        onChangeMetadataTags(metadata.tags || []);
      }
      if (onChangeQuickStartSpec) {
        onChangeQuickStartSpec(quickstartObj.spec);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Invalid YAML syntax';
      setParseError(errorMessage);
      setValidationWarnings([]);
      // Keep using the last valid quickstart state on error
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    const content = value || '';
    setYamlContent(content);

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounced update (200ms delay)
    debounceTimerRef.current = setTimeout(() => {
      parseAndUpdateQuickstart(content);
    }, 200);
  };

  // On unmount, flush any pending debounced parse so the parent state is
  // up-to-date before the wizard tab mounts.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        parseAndUpdateQuickstart(yamlContentRef.current);
      }
    };
  }, []);

  const confirmOverwriteIfDirty = (message: string): boolean => {
    if (!isUserContent(yamlContent)) return true;
    return window.confirm(message);
  };

  const handleLoadSample = () => {
    if (
      !confirmOverwriteIfDirty(
        'This will overwrite your current work. Are you sure?'
      )
    )
      return;
    setYamlContent(DEFAULT_QUICKSTART_YAML);
    parseAndUpdateQuickstart(DEFAULT_QUICKSTART_YAML);
  };

  const handleLoadFromFile = () => {
    if (
      !confirmOverwriteIfDirty(
        'Loading a file will overwrite your current work. Are you sure?'
      )
    )
      return;
    fileInputRef.current?.click();
  };

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result;
      if (typeof content === 'string') {
        setYamlContent(content);
        parseAndUpdateQuickstart(content);
      }
    };
    reader.onerror = () => {
      setParseError(
        `Failed to read file: ${reader.error?.message ?? 'unknown error'}`
      );
    };
    reader.readAsText(file);

    // Reset file input so the same file can be re-selected
    event.target.value = '';
  };

  const handleDownload = () => {
    files.forEach((file) => {
      const dotIndex = file.name.lastIndexOf('.');
      const baseName =
        dotIndex !== -1 ? file.name.substring(0, dotIndex) : file.name;
      const extension =
        dotIndex !== -1 ? file.name.substring(dotIndex + 1) : 'txt';
      downloadFile(file.content, baseName, extension);
    });
  };

  const handleOpenRepoModal = async () => {
    setRepoModalOpen(true);
    setRepoLoading(true);
    setRepoError(null);
    setRepoSearch('');
    try {
      const entries = await listRepoQuickstarts();
      setRepoQuickstarts(entries);
    } catch (err) {
      setRepoError(
        err instanceof Error ? err.message : 'Failed to load quickstarts'
      );
    } finally {
      setRepoLoading(false);
    }
  };

  const handleLoadFromRepo = async (name: string) => {
    setRepoModalOpen(false);
    try {
      const content = await getRepoQuickstartContent(name);
      const yamlFile = content.files.find(
        (f) =>
          (f.name.endsWith('.yml') || f.name.endsWith('.yaml')) &&
          !f.name.startsWith('metadata.')
      );
      if (yamlFile) {
        let finalContent = yamlFile.content;
        try {
          const parsed = YAML.parse(finalContent);
          if (parsed) {
            if (!parsed.metadata) parsed.metadata = {};

            const metadataFile = content.files.find((f) =>
              f.name.startsWith('metadata.')
            );
            if (metadataFile) {
              const meta = YAML.parse(metadataFile.content);
              if (Array.isArray(meta?.tags) && meta.tags.length > 0) {
                parsed.metadata.tags = meta.tags;
              }
            }

            if (!parsed.kind) {
              parsed.kind = 'QuickStarts';
            }

            const { kind, metadata, spec, ...rest } = parsed;
            finalContent = YAML.stringify(
              { kind, metadata, spec, ...rest },
              { lineWidth: 0, nullStr: '~' }
            );
          }
        } catch {
          // use raw content if parse fails
        }
        setYamlContent(finalContent);
        parseAndUpdateQuickstart(finalContent);
      }
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Failed to load quickstart'
      );
    }
  };

  const filteredRepoQuickstarts = repoQuickstarts.filter(
    (qs) =>
      qs.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
      qs.displayName.toLowerCase().includes(repoSearch.toLowerCase())
  );

  /**
   * Update the metadata.tags section inside the current YAML editor content
   * when bundles or tags are changed via the UI selectors.
   */
  const updateYamlTags = useCallback(
    (newBundles: string[], newTags: { [kind: string]: string[] }) => {
      try {
        const parsed = YAML.parse(yamlContentRef.current);
        if (!parsed || typeof parsed !== 'object') return;
        if (!parsed.metadata) parsed.metadata = {};

        const allTags: Array<{ kind: string; value: string }> = newBundles
          .toSorted()
          .map((b) => ({ kind: 'bundle', value: b }));
        Object.entries(newTags).forEach(([kind, values]) => {
          values.forEach((value) => allTags.push({ kind, value }));
        });

        parsed.metadata.tags = allTags.length > 0 ? allTags : undefined;

        const newYaml = YAML.stringify(parsed, { lineWidth: 0 });
        setYamlContent(newYaml);
        // Also update parent state immediately (no debounce)
        parseAndUpdateQuickstart(newYaml);
      } catch {
        // YAML is invalid — only update parent state via callbacks
      }
    },
    []
  );

  const handleBundlesChange = useCallback(
    (newBundles: string[]) => {
      updateYamlTags(newBundles, currentTags || {});
    },
    [currentTags, updateYamlTags]
  );

  const handleTagsChange = useCallback(
    (newTags: { [kind: string]: string[] }) => {
      updateYamlTags(currentBundles || [], newTags);
    },
    [currentBundles, updateYamlTags]
  );

  const hasMetadataSelectors =
    (bundleOptions && bundleOptions.length > 0) || filterData;

  const canDownload =
    isUserContent(yamlContent) && !parseError && files.length > 0;

  return (
    <PageSection className="lr-c-creator-yaml-view">
      {parseError && (
        <Alert
          variant="warning"
          title="YAML Parse Error"
          className="pf-v6-u-mb-md"
          isInline
        >
          {parseError}. Showing previous valid state in preview.
        </Alert>
      )}
      {validationWarnings.length > 0 && !parseError && (
        <Alert
          variant="info"
          title="Schema Validation"
          className="pf-v6-u-mb-md"
          isInline
        >
          <List>
            {validationWarnings.map((w, i) => (
              <ListItem key={i}>
                <strong>{w.field}</strong>: {w.message}
              </ListItem>
            ))}
          </List>
        </Alert>
      )}
      <Flex
        spaceItems={{ default: 'spaceItemsSm' }}
        className="lr-c-creator-yaml-view__toolbar"
      >
        <FlexItem>
          <Button
            variant="secondary"
            icon={<FileImportIcon />}
            onClick={handleLoadSample}
            size="sm"
          >
            Load Sample Template
          </Button>
        </FlexItem>
        <FlexItem>
          <Button
            variant="secondary"
            icon={<UploadIcon />}
            onClick={handleLoadFromFile}
            size="sm"
          >
            Load from File
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml"
            onChange={handleFileSelected}
            style={{ display: 'none' }}
            data-testid="yaml-file-input"
          />
        </FlexItem>
        {!showCreatePR && (
          <FlexItem>
            <Tooltip
              content="Download metadata.yaml and quickstart YAML files, same as wizard"
              position="top"
            >
              <Button
                variant="primary"
                icon={<DownloadIcon />}
                onClick={handleDownload}
                size="sm"
                isDisabled={!canDownload}
              >
                Download Files ({files.length})
              </Button>
            </Tooltip>
          </FlexItem>
        )}
        {showCreatePR && (
          <FlexItem>
            <Button
              variant="secondary"
              icon={<UploadIcon />}
              onClick={handleOpenRepoModal}
              size="sm"
            >
              Load from Repo
            </Button>
          </FlexItem>
        )}
        {showCreatePR && parsedName && parsedName !== 'untitled-quickstart' && (
          <FlexItem>
            <Label color="blue">Editing: {parsedName}</Label>
          </FlexItem>
        )}
      </Flex>
      {hasMetadataSelectors && (
        <Flex
          className="lr-c-creator-yaml-view__metadata"
          direction={{ default: 'column', md: 'row' }}
          gap={{ default: 'gapSm' }}
        >
          {bundleOptions && bundleOptions.length > 0 && (
            <FlexItem flex={{ default: 'flex_1' }}>
              <BundleSelector
                bundles={bundleOptions}
                selected={currentBundles || []}
                onChange={handleBundlesChange}
              />
            </FlexItem>
          )}
          {filterData && (
            <FlexItem flex={{ default: 'flex_1' }}>
              <StandaloneTagsSelector
                filterData={filterData}
                value={currentTags || {}}
                onChange={handleTagsChange}
              />
            </FlexItem>
          )}
        </Flex>
      )}
      <div className="lr-c-creator-yaml-view__editor">
        <Editor
          height="100%"
          language="yaml"
          theme="vs"
          value={yamlContent}
          onChange={handleEditorChange}
          beforeMount={configureMonacoEnvironment}
          options={{
            automaticLayout: true,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            fontSize: 14,
            lineNumbers: 'on',
            folding: true,
            renderWhitespace: 'selection',
          }}
        />
      </div>
      {showCreatePR && (
        <Flex
          spaceItems={{ default: 'spaceItemsSm' }}
          className="lr-c-creator-yaml-view__toolbar"
          alignItems={{ default: 'alignItemsCenter' }}
        >
          <FlexItem>
            <Tooltip
              content="Download metadata.yaml and quickstart YAML files, same as wizard"
              position="top"
            >
              <Button
                variant="primary"
                icon={<DownloadIcon />}
                onClick={handleDownload}
                size="sm"
                isDisabled={!canDownload}
              >
                Download Files ({files.length})
              </Button>
            </Tooltip>
          </FlexItem>
          <FlexItem>
            <Tooltip
              content="Submit quickstart YAML as a GitHub pull request"
              position="top"
            >
              <Button
                variant="primary"
                icon={<CodeBranchIcon />}
                onClick={handleOpenPRModal}
                size="sm"
                isDisabled={!canCreatePR || !canDownload}
              >
                Create PR
              </Button>
            </Tooltip>
          </FlexItem>
        </Flex>
      )}
      {showCreatePR && parsedName && (
        <CreatePRModal
          isOpen={prModalOpen}
          onClose={handleClosePRModal}
          onConfirm={handleCreatePR}
          quickstartName={parsedName}
          prLoading={prLoading}
          prResult={prResult}
          prError={prError}
        />
      )}
      {showCreatePR && (
        <Modal
          isOpen={repoModalOpen}
          onClose={() => setRepoModalOpen(false)}
          aria-label="Load from Repository"
          variant="medium"
        >
          <ModalHeader title="Load from Repository" />
          <ModalBody>
            <SearchInput
              placeholder="Search quickstarts..."
              value={repoSearch}
              onChange={(_event, value) => setRepoSearch(value)}
              onClear={() => setRepoSearch('')}
              className="pf-v6-u-mb-md"
            />
            {repoLoading && <Spinner size="lg" />}
            {repoError && (
              <Alert variant="danger" title="Error" isInline>
                {repoError}
              </Alert>
            )}
            {!repoLoading && !repoError && (
              <DataList aria-label="Repository quickstarts" isCompact>
                {filteredRepoQuickstarts.map((qs) => (
                  <DataListItem key={qs.name}>
                    <DataListItemRow>
                      <DataListItemCells
                        dataListCells={[
                          <DataListCell key="name">
                            <Button
                              variant="link"
                              isInline
                              onClick={() => handleLoadFromRepo(qs.name)}
                            >
                              {qs.displayName || qs.name}
                            </Button>
                          </DataListCell>,
                        ]}
                      />
                    </DataListItemRow>
                  </DataListItem>
                ))}
                {filteredRepoQuickstarts.length === 0 && (
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
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="link" onClick={() => setRepoModalOpen(false)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </PageSection>
  );
};

export default CreatorYAMLView;
