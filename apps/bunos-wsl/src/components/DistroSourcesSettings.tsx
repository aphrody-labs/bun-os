import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { wslService } from "../services/wslService";
import type { DistroCatalog, DownloadDistro, ContainerImage, MsStoreDistroInfo } from "../types/catalog";
import { SourceDownloadIcon, ContainerIcon, StoreIcon, EditIcon, TrashIcon, CloseIcon } from "./icons";
import { getDistroLogo } from "./icons/DistroLogos";
import { Button, IconButton } from "./ui/Button";

type TabType = "msstore" | "container" | "download";

// Tab configuration matching NewDistroDialog (ordered: Quick Install, Container, Download)
const TAB_CONFIG: Record<TabType, { labelKey: string; color: string; Icon: React.FC<{ className?: string }> }> = {
  msstore: {
    labelKey: "distroSources.tab.quickInstall",
    color: "emerald",
    Icon: StoreIcon,
  },
  container: {
    labelKey: "distroSources.tab.container",
    color: "orange",
    Icon: ContainerIcon,
  },
  download: {
    labelKey: "distroSources.tab.download",
    color: "blue",
    Icon: SourceDownloadIcon,
  },
};

function generateId(): string {
  return `distro-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// In-app confirmation dialog component
function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-scrim/32" onClick={onCancel} />
      <div className="relative bg-surface-container-low border border-outline-variant rounded-xl shadow-md3-3 max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-on-surface mb-2">{title}</h3>
        <p className="text-sm text-on-surface-variant mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="primary" colorScheme="error" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DistroSourcesSettings() {
  const { t } = useTranslation("install");
  const [catalog, setCatalog] = useState<DistroCatalog | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("msstore");

  // Form states
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  // Ref for form container to scroll into view
  const formRef = useRef<HTMLDivElement>(null);

  // Helper to scroll form into view
  const scrollToForm = () => {
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  // Download distro form
  const [downloadForm, setDownloadForm] = useState({
    id: "",
    name: "",
    description: "",
    url: "",
    size: "",
  });

  // Container image form
  const [containerForm, setContainerForm] = useState({
    id: "",
    name: "",
    description: "",
    image: "",
  });

  // MS Store form
  const [msStoreForm, setMsStoreForm] = useState({
    distroId: "",
    description: "",
    enabled: true,
  });

  useEffect(() => {
    loadCatalog();
  }, []);

  const loadCatalog = async () => {
    setIsLoading(true);
    try {
      const data = await wslService.getDistroCatalog();
      setCatalog(data);
    } catch (err) {
      // Tauri returns string errors, not Error instances
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to load catalog";
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const resetForms = () => {
    setDownloadForm({ id: "", name: "", description: "", url: "", size: "" });
    setContainerForm({ id: "", name: "", description: "", image: "" });
    setMsStoreForm({ distroId: "", description: "", enabled: true });
    setIsAdding(false);
    setEditingId(null);
    setError(null);
  };

  // Show confirmation dialog helper
  const showConfirmDialog = (
    title: string,
    message: string,
    confirmLabel: string,
    onConfirm: () => void
  ) => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      confirmLabel,
      onConfirm: () => {
        onConfirm();
        setConfirmDialog(null);
      },
    });
  };

  // Download Distro handlers
  const handleAddDownload = async () => {
    if (!downloadForm.name || !downloadForm.url) return;

    try {
      const distro: DownloadDistro = {
        id: downloadForm.id || generateId(),
        name: downloadForm.name,
        description: downloadForm.description,
        url: downloadForm.url,
        size: downloadForm.size || undefined,
        enabled: true,
      };
      const updated = await wslService.addDownloadDistro(distro);
      setCatalog(updated);
      resetForms();
    } catch (err) {
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to add distro";
      setError(errorMsg);
    }
  };

  const handleUpdateDownload = async () => {
    if (!editingId || !downloadForm.name || !downloadForm.url) return;

    try {
      const distro: DownloadDistro = {
        id: editingId,
        name: downloadForm.name,
        description: downloadForm.description,
        url: downloadForm.url,
        size: downloadForm.size || undefined,
        // Preserve the enabled state: hardcoding true silently re-enabled a
        // disabled source on every edit (GH #120)
        enabled: catalog?.downloadDistros.find((d) => d.id === editingId)?.enabled ?? true,
      };
      const updated = await wslService.updateDownloadDistro(distro);
      setCatalog(updated);
      resetForms();
    } catch (err) {
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to update distro";
      setError(errorMsg);
    }
  };

  const handleToggleDownload = async (distro: DownloadDistro) => {
    try {
      const updated = await wslService.updateDownloadDistro({
        ...distro,
        enabled: !distro.enabled,
      });
      setCatalog(updated);
    } catch (err) {
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to toggle distro";
      setError(errorMsg);
    }
  };

  const handleDeleteDownload = async (id: string) => {
    try {
      const updated = await wslService.deleteDownloadDistro(id);
      setCatalog(updated);
    } catch (err) {
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to delete distro";
      setError(errorMsg);
    }
  };

  const startEditDownload = (distro: DownloadDistro) => {
    setDownloadForm({
      id: distro.id,
      name: distro.name,
      description: distro.description,
      url: distro.url,
      size: distro.size || "",
    });
    setEditingId(distro.id);
    setIsAdding(true);
    scrollToForm();
  };

  // Container Image handlers
  const handleAddContainer = async () => {
    if (!containerForm.name || !containerForm.image) return;

    try {
      const image: ContainerImage = {
        id: containerForm.id || generateId(),
        name: containerForm.name,
        description: containerForm.description,
        image: containerForm.image,
        enabled: true,
      };
      const updated = await wslService.addContainerImage(image);
      setCatalog(updated);
      resetForms();
    } catch (err) {
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to add container image";
      setError(errorMsg);
    }
  };

  const handleUpdateContainer = async () => {
    if (!editingId || !containerForm.name || !containerForm.image) return;

    try {
      const image: ContainerImage = {
        id: editingId,
        name: containerForm.name,
        description: containerForm.description,
        image: containerForm.image,
        // Preserve the enabled state: hardcoding true silently re-enabled a
        // disabled image on every edit (GH #120)
        enabled: catalog?.containerImages.find((i) => i.id === editingId)?.enabled ?? true,
      };
      const updated = await wslService.updateContainerImage(image);
      setCatalog(updated);
      resetForms();
    } catch (err) {
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to update container image";
      setError(errorMsg);
    }
  };

  const handleToggleContainer = async (image: ContainerImage) => {
    try {
      const updated = await wslService.updateContainerImage({
        ...image,
        enabled: !image.enabled,
      });
      setCatalog(updated);
    } catch (err) {
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to toggle container image";
      setError(errorMsg);
    }
  };

  const handleDeleteContainer = async (id: string) => {
    try {
      const updated = await wslService.deleteContainerImage(id);
      setCatalog(updated);
    } catch (err) {
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to delete container image";
      setError(errorMsg);
    }
  };

  const startEditContainer = (image: ContainerImage) => {
    setContainerForm({
      id: image.id,
      name: image.name,
      description: image.description,
      image: image.image,
    });
    setEditingId(image.id);
    setIsAdding(true);
    scrollToForm();
  };

  // MS Store handlers
  const handleAddMsStore = async () => {
    if (!msStoreForm.distroId) return;

    try {
      const info: MsStoreDistroInfo = {
        description: msStoreForm.description,
        enabled: msStoreForm.enabled,
      };
      const updated = await wslService.updateMsStoreDistro(msStoreForm.distroId, info);
      setCatalog(updated);
      resetForms();
    } catch (err) {
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to add MS Store metadata";
      setError(errorMsg);
    }
  };

  const handleToggleMsStore = async (distroId: string, info: MsStoreDistroInfo) => {
    try {
      const updated = await wslService.updateMsStoreDistro(distroId, {
        ...info,
        enabled: !info.enabled,
      });
      setCatalog(updated);
    } catch (err) {
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to toggle MS Store metadata";
      setError(errorMsg);
    }
  };

  const handleDeleteMsStore = async (distroId: string) => {
    try {
      const updated = await wslService.deleteMsStoreDistro(distroId);
      setCatalog(updated);
    } catch (err) {
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to delete MS Store metadata";
      setError(errorMsg);
    }
  };

  const startEditMsStore = (distroId: string, info: MsStoreDistroInfo) => {
    setMsStoreForm({
      distroId,
      description: info.description,
      enabled: info.enabled !== false,
    });
    setEditingId(distroId);
    setIsAdding(true);
    scrollToForm();
  };

  // Per-tab reset handlers
  const handleResetDownloads = () => {
    showConfirmDialog(
      t('distroSources.dialog.resetDownloadSources'),
      t('distroSources.dialog.resetDownloadSourcesMessage'),
      t('distroSources.dialog.resetDownloads'),
      async () => {
        try {
          const updated = await wslService.resetDownloadDistros();
          setCatalog(updated);
          setError(null);
        } catch (err) {
          const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to reset downloads";
          setError(errorMsg);
        }
      }
    );
  };

  const handleResetContainers = () => {
    showConfirmDialog(
      t('distroSources.dialog.resetContainerImages'),
      t('distroSources.dialog.resetContainerImagesMessage'),
      t('distroSources.dialog.resetContainers'),
      async () => {
        try {
          const updated = await wslService.resetContainerImages();
          setCatalog(updated);
          setError(null);
        } catch (err) {
          const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to reset containers";
          setError(errorMsg);
        }
      }
    );
  };

  const handleResetMsStore = () => {
    showConfirmDialog(
      t('distroSources.dialog.resetQuickInstallMetadata'),
      t('distroSources.dialog.resetQuickInstallMetadataMessage'),
      t('distroSources.dialog.resetMetadata'),
      async () => {
        try {
          const updated = await wslService.resetMsStoreDistros();
          setCatalog(updated);
          setError(null);
        } catch (err) {
          const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to reset metadata";
          setError(errorMsg);
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Sort helper function (alphabetically by name)
  const sortByName = <T extends { name: string }>(items: T[]): T[] => {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  };

  // Sort MS Store entries alphabetically by distro ID
  const sortedMsStoreEntries = Object.entries(catalog?.msStoreDistros || {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  // Sorted download distros and container images
  const sortedDownloadDistros = sortByName(catalog?.downloadDistros || []);
  const sortedContainerImages = sortByName(catalog?.containerImages || []);

  return (
    <div className="space-y-4">
      {/* Confirmation Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          cancelLabel={t('distroSources.button.cancel')}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      <div className="bg-secondary-container border border-outline-variant rounded-lg p-4">
        <p className="text-sm text-secondary">
          <span className="font-medium">{t('distroSources.title')}</span> - {t('distroSources.description')}
        </p>
      </div>

      {error && (
        <div className="bg-error-container border border-outline-variant rounded-lg p-4 flex items-center justify-between">
          <p className="text-sm text-error">{error}</p>
          <IconButton
            icon={<CloseIcon size="sm" />}
            label={t('distroSources.action.dismissError')}
            variant="ghost"
            colorScheme="error"
            size="sm"
            onClick={() => setError(null)}
          />
        </div>
      )}

      {/* Tabs - matching NewDistroDialog style */}
      <div className="flex gap-1 bg-surface-container p-1 rounded-lg">
        {(Object.entries(TAB_CONFIG) as [TabType, typeof TAB_CONFIG.download][]).map(
          ([key, config]) => {
            const isActive = activeTab === key;
            const colorClasses = {
              blue: isActive
                ? "bg-secondary text-on-secondary shadow-md3-1"
                : "text-on-surface-variant hover:text-on-surface",
              orange: isActive
                ? "bg-primary text-on-primary shadow-md3-1"
                : "text-on-surface-variant hover:text-on-surface",
              emerald: isActive
                ? "bg-success text-on-success shadow-md3-1"
                : "text-on-surface-variant hover:text-on-surface",
            }[config.color];

            return (
              <button
                key={key}
                onClick={() => {
                  setActiveTab(key);
                  resetForms();
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-sm font-medium rounded-md transition-all ${colorClasses}`}
              >
                <config.Icon className="w-4 h-4" />
                {t(config.labelKey)}
              </button>
            );
          }
        )}
      </div>

      {/* Download Sources Tab */}
      {activeTab === "download" && (
        <div className="space-y-4">
          {isAdding ? (
            <div
              ref={formRef}
              className="bg-secondary-container border border-outline-variant rounded-xl p-4 space-y-3"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
                  <SourceDownloadIcon className="w-4 h-4 text-on-secondary" />
                </div>
                <h3 className="font-medium text-on-surface">
                  {editingId ? t('distroSources.dialog.editDownloadSource') : t('distroSources.dialog.addDownloadSource')}
                </h3>
              </div>
              <div>
                <label className="block text-sm text-on-surface-variant mb-1">{t('distroSources.form.nameRequired')}</label>
                <input
                  type="text"
                  value={downloadForm.name}
                  onChange={(e) => setDownloadForm({ ...downloadForm, name: e.target.value })}
                  placeholder={t('distroSources.form.placeholder.downloadName')}
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface focus:border-secondary"
                />
              </div>
              <div>
                <label className="block text-sm text-on-surface-variant mb-1">{t('distroSources.form.description')}</label>
                <input
                  type="text"
                  value={downloadForm.description}
                  onChange={(e) =>
                    setDownloadForm({ ...downloadForm, description: e.target.value })
                  }
                  placeholder={t('distroSources.form.placeholder.downloadDescription')}
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface focus:border-secondary"
                />
              </div>
              <div>
                <label className="block text-sm text-on-surface-variant mb-1">{t('distroSources.form.downloadUrl')}</label>
                <input
                  type="url"
                  value={downloadForm.url}
                  onChange={(e) => setDownloadForm({ ...downloadForm, url: e.target.value })}
                  placeholder={t('distroSources.form.placeholder.downloadUrl')}
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface focus:border-secondary"
                />
              </div>
              <div>
                <label className="block text-sm text-on-surface-variant mb-1">{t('distroSources.form.sizeOptional')}</label>
                <input
                  type="text"
                  value={downloadForm.size}
                  onChange={(e) => setDownloadForm({ ...downloadForm, size: e.target.value })}
                  placeholder={t('distroSources.form.placeholder.downloadSize')}
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface focus:border-secondary"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="ghost" onClick={resetForms}>
                  {t('common:button.cancel')}
                </Button>
                <Button
                  variant="primary"
                  colorScheme="secondary"
                  onClick={editingId ? handleUpdateDownload : handleAddDownload}
                  disabled={!downloadForm.name || !downloadForm.url}
                >
                  {editingId ? t('distroSources.button.update') : t('distroSources.button.add')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-between items-center">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs hover:text-error"
                onClick={handleResetDownloads}
              >
                {t('common:button.resetToDefault')}
              </Button>
              <Button variant="primary" colorScheme="secondary" size="sm" onClick={() => setIsAdding(true)}>
                + {t('distroSources.addUrl')}
              </Button>
            </div>
          )}

          {sortedDownloadDistros.length === 0 ? (
            <div className="text-center py-12 bg-surface-container/50 border border-outline-variant rounded-xl">
              <SourceDownloadIcon className="w-8 h-8 mx-auto mb-2 text-on-surface-variant opacity-50" />
              <p className="text-on-surface-variant">{t('distroSources.empty.downloads')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedDownloadDistros.map((distro) => {
                const Logo = getDistroLogo(distro.id);
                return (
                <div
                  key={distro.id}
                  className={`flex items-center gap-4 p-4 bg-surface-container/50 border rounded-xl transition-opacity ${
                    distro.enabled
                      ? "border-outline-variant"
                      : "border-outline-variant/50 opacity-60"
                  }`}
                >
                  <div className="shrink-0 rounded-xl p-1.5 bg-surface-container">
                    <Logo size={32} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-on-surface">{distro.name}</h4>
                      {distro.isBuiltIn && (
                        <span className="text-xs px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded-sm">
                          {t('distroSources.badge.builtIn')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-on-surface-variant truncate">{distro.description}</p>
                    {distro.size && <p className="text-xs text-on-surface-variant/70">{distro.size}</p>}
                  </div>
                  <IconButton
                    icon={<EditIcon size="sm" />}
                    label={t('distroSources.action.edit')}
                    variant="ghost"
                    colorScheme="secondary"
                    onClick={() => startEditDownload(distro)}
                  />
                  {!distro.isBuiltIn && (
                    <IconButton
                      icon={<TrashIcon size="sm" />}
                      label={t('distroSources.action.delete')}
                      variant="ghost"
                      colorScheme="error"
                      onClick={() => handleDeleteDownload(distro.id)}
                    />
                  )}
                  <button
                    onClick={() => handleToggleDownload(distro)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      distro.enabled ? "bg-secondary" : "bg-outline-variant"
                    }`}
                    title={distro.enabled ? t('distroSources.toggle.disable') : t('distroSources.toggle.enable')}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-surface-container-lowest transition-transform ${
                        distro.enabled ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              );
              })}
            </div>
          )}
        </div>
      )}

      {/* Container Images Tab */}
      {activeTab === "container" && (
        <div className="space-y-4">
          {isAdding ? (
            <div
              ref={formRef}
              className="bg-primary-container border border-outline-variant rounded-xl p-4 space-y-3"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <ContainerIcon className="w-4 h-4 text-on-primary" />
                </div>
                <h3 className="font-medium text-on-surface">
                  {editingId ? t('distroSources.dialog.editContainerImage') : t('distroSources.dialog.addContainerImage')}
                </h3>
              </div>
              <div>
                <label className="block text-sm text-on-surface-variant mb-1">{t('distroSources.form.nameRequired')}</label>
                <input
                  type="text"
                  value={containerForm.name}
                  onChange={(e) => setContainerForm({ ...containerForm, name: e.target.value })}
                  placeholder={t('distroSources.form.placeholder.containerName')}
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-on-surface-variant mb-1">{t('distroSources.form.description')}</label>
                <input
                  type="text"
                  value={containerForm.description}
                  onChange={(e) =>
                    setContainerForm({ ...containerForm, description: e.target.value })
                  }
                  placeholder={t('distroSources.form.placeholder.containerDescription')}
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-on-surface-variant mb-1">{t('distroSources.form.containerImage')}</label>
                <input
                  type="text"
                  value={containerForm.image}
                  onChange={(e) => setContainerForm({ ...containerForm, image: e.target.value })}
                  placeholder={t('distroSources.form.placeholder.containerImage')}
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface focus:border-primary"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="ghost" onClick={resetForms}>
                  {t('common:button.cancel')}
                </Button>
                <Button
                  variant="primary"
                  colorScheme="primary"
                  onClick={editingId ? handleUpdateContainer : handleAddContainer}
                  disabled={!containerForm.name || !containerForm.image}
                >
                  {editingId ? t('distroSources.button.update') : t('distroSources.button.add')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-between items-center">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs hover:text-error"
                onClick={handleResetContainers}
              >
                {t('common:button.resetToDefault')}
              </Button>
              <Button variant="primary" colorScheme="primary" size="sm" onClick={() => setIsAdding(true)}>
                + {t('distroSources.addUrl')}
              </Button>
            </div>
          )}

          {sortedContainerImages.length === 0 ? (
            <div className="text-center py-12 bg-surface-container/50 border border-outline-variant rounded-xl">
              <ContainerIcon className="w-8 h-8 mx-auto mb-2 text-on-surface-variant opacity-50" />
              <p className="text-on-surface-variant">{t('distroSources.empty.containers')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedContainerImages.map((image) => {
                const Logo = getDistroLogo(image.id);
                return (
                <div
                  key={image.id}
                  className={`flex items-center gap-4 p-4 bg-surface-container/50 border rounded-xl transition-opacity ${
                    image.enabled
                      ? "border-outline-variant"
                      : "border-outline-variant/50 opacity-60"
                  }`}
                >
                  <div className="shrink-0 rounded-xl p-1.5 bg-surface-container">
                    <Logo size={32} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-on-surface">{image.name}</h4>
                      {image.isBuiltIn && (
                        <span className="text-xs px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded-sm">
                          {t('distroSources.badge.builtIn')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-on-surface-variant">{image.description}</p>
                    <p className="text-xs text-on-surface-variant/70 truncate">{image.image}</p>
                  </div>
                  <IconButton
                    icon={<EditIcon size="sm" />}
                    label={t('distroSources.action.edit')}
                    variant="ghost"
                    colorScheme="primary"
                    onClick={() => startEditContainer(image)}
                  />
                  {!image.isBuiltIn && (
                    <IconButton
                      icon={<TrashIcon size="sm" />}
                      label={t('distroSources.action.delete')}
                      variant="ghost"
                      colorScheme="error"
                      onClick={() => handleDeleteContainer(image.id)}
                    />
                  )}
                  <button
                    onClick={() => handleToggleContainer(image)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      image.enabled ? "bg-primary" : "bg-outline-variant"
                    }`}
                    title={image.enabled ? t('distroSources.toggle.disable') : t('distroSources.toggle.enable')}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-surface-container-lowest transition-transform ${
                        image.enabled ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              );
              })}
            </div>
          )}
        </div>
      )}

      {/* MS Store Metadata Tab */}
      {activeTab === "msstore" && (
        <div className="space-y-4">
          <div className="bg-success-container border border-outline-variant rounded-lg p-3 text-xs text-success">
            <div className="flex items-start gap-2">
              <StoreIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span dangerouslySetInnerHTML={{ __html: t('distroSources.info.quickInstall') }} />
            </div>
          </div>

          {isAdding ? (
            <div
              ref={formRef}
              className="bg-success-container border border-outline-variant rounded-xl p-4 space-y-3"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-success flex items-center justify-center">
                  <StoreIcon className="w-4 h-4 text-on-success" />
                </div>
                <h3 className="font-medium text-on-surface">
                  {editingId ? t('distroSources.dialog.editQuickInstallMetadata') : t('distroSources.dialog.addQuickInstallMetadata')}
                </h3>
              </div>
              <div>
                <label className="block text-sm text-on-surface-variant mb-1">{t('distroSources.form.distroId')}</label>
                <input
                  type="text"
                  value={msStoreForm.distroId}
                  onChange={(e) => setMsStoreForm({ ...msStoreForm, distroId: e.target.value })}
                  placeholder={t('distroSources.form.placeholder.msStoreDistroId')}
                  disabled={!!editingId}
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface focus:border-success disabled:opacity-50"
                />
                <p className="text-xs text-on-surface-variant mt-1" dangerouslySetInnerHTML={{ __html: t('distroSources.form.distroIdHint') }} />
              </div>
              <div>
                <label className="block text-sm text-on-surface-variant mb-1">{t('distroSources.form.description')}</label>
                <input
                  type="text"
                  value={msStoreForm.description}
                  onChange={(e) =>
                    setMsStoreForm({ ...msStoreForm, description: e.target.value })
                  }
                  placeholder={t('distroSources.form.placeholder.msStoreDescription')}
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface focus:border-success"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="ghost" onClick={resetForms}>
                  {t('common:button.cancel')}
                </Button>
                <Button
                  variant="primary"
                  colorScheme="success"
                  onClick={handleAddMsStore}
                  disabled={!msStoreForm.distroId}
                >
                  {editingId ? t('distroSources.button.update') : t('distroSources.button.add')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-between items-center">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs hover:text-error"
                onClick={handleResetMsStore}
              >
                {t('common:button.resetToDefault')}
              </Button>
              <Button variant="primary" colorScheme="success" size="sm" onClick={() => setIsAdding(true)}>
                + {t('distroSources.addUrl')}
              </Button>
            </div>
          )}

          {sortedMsStoreEntries.length === 0 ? (
            <div className="text-center py-12 bg-surface-container/50 border border-outline-variant rounded-xl">
              <StoreIcon className="w-8 h-8 mx-auto mb-2 text-on-surface-variant opacity-50" />
              <p className="text-on-surface-variant">{t('distroSources.empty.quickInstall')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedMsStoreEntries.map(([distroId, info]) => {
                const Logo = getDistroLogo(distroId);
                return (
                <div
                  key={distroId}
                  className={`flex items-center gap-4 p-4 bg-surface-container/50 border rounded-xl transition-opacity ${
                    info.enabled !== false
                      ? "border-outline-variant"
                      : "border-outline-variant/50 opacity-60"
                  }`}
                >
                  <div className="shrink-0 rounded-xl p-1.5 bg-surface-container">
                    <Logo size={32} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-on-surface">{distroId}</h4>
                    <p className="text-xs text-on-surface-variant">{info.description}</p>
                  </div>
                  <IconButton
                    icon={<EditIcon size="sm" />}
                    label={t('distroSources.action.edit')}
                    variant="ghost"
                    colorScheme="success"
                    onClick={() => startEditMsStore(distroId, info)}
                  />
                  <IconButton
                    icon={<TrashIcon size="sm" />}
                    label={t('distroSources.action.delete')}
                    variant="ghost"
                    colorScheme="error"
                    onClick={() => handleDeleteMsStore(distroId)}
                  />
                  <button
                    onClick={() => handleToggleMsStore(distroId, info)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      info.enabled !== false ? "bg-success" : "bg-outline-variant"
                    }`}
                    title={info.enabled !== false ? t('distroSources.toggle.disable') : t('distroSources.toggle.enable')}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-surface-container-lowest transition-transform ${
                        info.enabled !== false ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
