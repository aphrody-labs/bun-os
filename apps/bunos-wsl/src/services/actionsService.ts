import { invoke } from "@tauri-apps/api/core";
import type { CustomAction } from "../types/actions";
import { debug, info } from "../utils/logger";

export interface ActionResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Custom Actions Service - communicates with Tauri backend for action management
 */
export const actionsService = {
  /**
   * Get all custom actions
   */
  async getActions(): Promise<CustomAction[]> {
    debug("[actionsService] Getting custom actions");
    return await invoke<CustomAction[]>("get_custom_actions");
  },

  /**
   * Add a new custom action
   */
  async addAction(action: CustomAction): Promise<CustomAction[]> {
    info(`[actionsService] Adding action: ${action.name}`);
    return await invoke<CustomAction[]>("add_custom_action", { action });
  },

  /**
   * Update an existing custom action
   */
  async updateAction(action: CustomAction): Promise<CustomAction[]> {
    info(`[actionsService] Updating action: ${action.name}`);
    return await invoke<CustomAction[]>("update_custom_action", { action });
  },

  /**
   * Delete a custom action
   */
  async deleteAction(id: string): Promise<CustomAction[]> {
    info(`[actionsService] Deleting action: ${id}`);
    return await invoke<CustomAction[]>("delete_custom_action", { id });
  },

  /**
   * Execute a custom action on a distribution
   * @param actionId - The action ID to execute
   * @param distro - The distribution to execute on
   * @param id - Optional distribution GUID for reliable identification
   * @param password - Optional password for sudo commands
   */
  async executeAction(actionId: string, distro: string, id?: string, password?: string): Promise<ActionResult> {
    info(`[actionsService] Executing action ${actionId} on ${distro}`);
    const result = await invoke<ActionResult>("execute_custom_action", { actionId, distro, id, password });
    debug(`[actionsService] Action result: success=${result.success}`);
    return result;
  },

  /**
   * Run a custom action in the user's terminal
   * The terminal will show real-time output and stay open after completion
   * @param actionId - The action ID to execute
   * @param distro - The distribution to execute on
   * @param id - Optional distribution GUID for reliable identification
   */
  async runActionInTerminal(actionId: string, distro: string, id?: string): Promise<void> {
    info(`[actionsService] Running action ${actionId} in terminal on ${distro}`);
    await invoke<void>("run_action_in_terminal", { actionId, distro, id });
  },

  /**
   * Export actions as JSON string
   */
  async exportActions(): Promise<string> {
    info("[actionsService] Exporting actions");
    return await invoke<string>("export_custom_actions");
  },

  /**
   * Export actions to a file at the specified path
   */
  async exportActionsToFile(path: string): Promise<void> {
    info(`[actionsService] Exporting actions to file: ${path}`);
    await invoke<void>("export_custom_actions_to_file", { path });
  },

  /**
   * Import actions from JSON string
   */
  async importActions(json: string, merge: boolean): Promise<CustomAction[]> {
    info(`[actionsService] Importing actions (merge=${merge})`);
    return await invoke<CustomAction[]>("import_custom_actions", { json, merge });
  },

  /**
   * Import actions from a file at the specified path
   */
  async importActionsFromFile(path: string, merge: boolean): Promise<CustomAction[]> {
    info(`[actionsService] Importing actions from file: ${path} (merge=${merge})`);
    return await invoke<CustomAction[]>("import_custom_actions_from_file", { path, merge });
  },

  /**
   * Check if an action applies to a specific distro
   */
  async checkActionApplies(actionId: string, distro: string): Promise<boolean> {
    debug(`[actionsService] Checking if action ${actionId} applies to ${distro}`);
    return await invoke<boolean>("check_action_applies", { actionId, distro });
  },

  /**
   * Get all custom actions that should run on startup for a specific distribution
   */
  async getStartupActionsForDistro(distroName: string): Promise<CustomAction[]> {
    debug(`[actionsService] Getting startup actions for: ${distroName}`);
    return await invoke<CustomAction[]>("get_startup_actions_for_distro", { distroName });
  },
};

