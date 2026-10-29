import { create } from "zustand";
import type { CustomAction } from "../types/actions";
import { actionsService, ActionResult } from "../services/actionsService";
import { logger } from "../utils/logger";

// Startup action output for displaying in App.tsx
export interface StartupActionOutput {
  actionName: string;
  distro: string;
  output: string;
  error?: string;
}

interface ActionsStore {
  actions: CustomAction[];
  isLoading: boolean;
  error: string | null;
  executionResult: ActionResult | null;
  isExecuting: boolean;
  startupActionOutput: StartupActionOutput | null;

  // Actions
  fetchActions: () => Promise<void>;
  addAction: (action: CustomAction) => Promise<void>;
  updateAction: (action: CustomAction) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
  executeAction: (actionId: string, distro: string, distroId?: string, password?: string) => Promise<ActionResult | null>;
  runActionInTerminal: (actionId: string, distro: string, distroId?: string) => Promise<void>;
  exportActions: () => Promise<string | null>;
  exportActionsToFile: (path: string) => Promise<void>;
  importActions: (json: string, merge: boolean) => Promise<void>;
  importActionsFromFile: (path: string, merge: boolean) => Promise<void>;
  clearExecutionResult: () => void;
  setStartupActionOutput: (output: StartupActionOutput) => void;
  clearStartupActionOutput: () => void;
}

export const useActionsStore = create<ActionsStore>((set) => ({
  actions: [],
  isLoading: false,
  error: null,
  executionResult: null,
  isExecuting: false,
  startupActionOutput: null,

  fetchActions: async () => {
    set({ isLoading: true, error: null });
    try {
      const actions = await actionsService.getActions();
      set({ actions, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to fetch actions",
        isLoading: false,
      });
    }
  },

  addAction: async (action: CustomAction) => {
    set({ isLoading: true, error: null });
    try {
      const actions = await actionsService.addAction(action);
      set({ actions, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to add action",
        isLoading: false,
      });
    }
  },

  updateAction: async (action: CustomAction) => {
    set({ isLoading: true, error: null });
    try {
      const actions = await actionsService.updateAction(action);
      set({ actions, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to update action",
        isLoading: false,
      });
    }
  },

  deleteAction: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const actions = await actionsService.deleteAction(id);
      set({ actions, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to delete action",
        isLoading: false,
      });
    }
  },

  executeAction: async (actionId: string, distro: string, distroId?: string, password?: string) => {
    set({ isExecuting: true, executionResult: null, error: null });
    try {
      const result = await actionsService.executeAction(actionId, distro, distroId, password);
      set({ executionResult: result, isExecuting: false });
      return result;
    } catch (error) {
      const errorResult: ActionResult = {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : "Failed to execute action",
      };
      set({
        executionResult: errorResult,
        isExecuting: false,
      });
      return errorResult;
    }
  },

  runActionInTerminal: async (actionId: string, distro: string, distroId?: string) => {
    try {
      await actionsService.runActionInTerminal(actionId, distro, distroId);
    } catch (error) {
      logger.error("Failed to run action in terminal:", "ActionsStore", error);
      throw error;
    }
  },

  exportActions: async () => {
    try {
      return await actionsService.exportActions();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to export actions",
      });
      return null;
    }
  },

  exportActionsToFile: async (path: string) => {
    try {
      await actionsService.exportActionsToFile(path);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to export actions to file",
      });
      throw error; // Re-throw so caller knows it failed
    }
  },

  importActions: async (json: string, merge: boolean) => {
    set({ isLoading: true, error: null });
    try {
      const actions = await actionsService.importActions(json, merge);
      set({ actions, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to import actions",
        isLoading: false,
      });
    }
  },

  importActionsFromFile: async (path: string, merge: boolean) => {
    set({ isLoading: true, error: null });
    try {
      const actions = await actionsService.importActionsFromFile(path, merge);
      set({ actions, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to import actions from file",
        isLoading: false,
      });
    }
  },

  clearExecutionResult: () => {
    set({ executionResult: null });
  },

  setStartupActionOutput: (output: StartupActionOutput) => {
    set({ startupActionOutput: output });
  },

  clearStartupActionOutput: () => {
    set({ startupActionOutput: null });
  },
}));
