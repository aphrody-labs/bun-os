import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useActionsStore } from "./actionsStore";
import type { CustomAction } from "../types/actions";

// Note: @tauri-apps/api/core is mocked in test/setup.ts

const mockAction: CustomAction = {
  id: "action-1",
  name: "Test Action",
  command: "echo hello",
  icon: "terminal",
  scope: { type: "all" },
  confirmBeforeRun: false,
  requiresSudo: false,
  requiresStopped: false,
  runInTerminal: false,
  runOnStartup: false,
  showOutput: true,
  order: 0,
};

describe("actionsStore", () => {
  beforeEach(() => {
    // Reset store state
    useActionsStore.setState({
      actions: [],
      isLoading: false,
      error: null,
      executionResult: null,
      isExecuting: false,
      startupActionOutput: null,
    });
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("should have empty actions initially", () => {
      const state = useActionsStore.getState();
      expect(state.actions).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.executionResult).toBeNull();
      expect(state.isExecuting).toBe(false);
      expect(state.startupActionOutput).toBeNull();
    });
  });

  describe("fetchActions", () => {
    it("sets loading state while fetching", async () => {
      vi.mocked(invoke).mockResolvedValue([]);

      const fetchPromise = useActionsStore.getState().fetchActions();

      expect(useActionsStore.getState().isLoading).toBe(true);

      await fetchPromise;

      expect(useActionsStore.getState().isLoading).toBe(false);
    });

    it("stores fetched actions", async () => {
      const mockActions = [mockAction];
      vi.mocked(invoke).mockResolvedValue(mockActions);

      await useActionsStore.getState().fetchActions();

      expect(useActionsStore.getState().actions).toEqual(mockActions);
    });

    it("calls invoke with correct command", async () => {
      vi.mocked(invoke).mockResolvedValue([]);

      await useActionsStore.getState().fetchActions();

      expect(invoke).toHaveBeenCalledWith("get_custom_actions");
    });

    it("sets error on fetch failure", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("Fetch failed"));

      await useActionsStore.getState().fetchActions();

      expect(useActionsStore.getState().error).toBe("Fetch failed");
      expect(useActionsStore.getState().isLoading).toBe(false);
    });

    it("handles non-Error rejection", async () => {
      vi.mocked(invoke).mockRejectedValue("String error");

      await useActionsStore.getState().fetchActions();

      expect(useActionsStore.getState().error).toBe("Failed to fetch actions");
    });
  });

  describe("addAction", () => {
    it("sets loading state while adding", async () => {
      vi.mocked(invoke).mockResolvedValue([mockAction]);

      const addPromise = useActionsStore.getState().addAction(mockAction);

      expect(useActionsStore.getState().isLoading).toBe(true);

      await addPromise;

      expect(useActionsStore.getState().isLoading).toBe(false);
    });

    it("updates actions after successful add", async () => {
      const updatedActions = [mockAction];
      vi.mocked(invoke).mockResolvedValue(updatedActions);

      await useActionsStore.getState().addAction(mockAction);

      expect(useActionsStore.getState().actions).toEqual(updatedActions);
    });

    it("calls invoke with correct command and action", async () => {
      vi.mocked(invoke).mockResolvedValue([mockAction]);

      await useActionsStore.getState().addAction(mockAction);

      expect(invoke).toHaveBeenCalledWith("add_custom_action", {
        action: mockAction,
      });
    });

    it("sets error on add failure", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("Add failed"));

      await useActionsStore.getState().addAction(mockAction);

      expect(useActionsStore.getState().error).toBe("Add failed");
    });
  });

  describe("updateAction", () => {
    it("updates actions after successful update", async () => {
      const updatedAction = { ...mockAction, name: "Updated Action" };
      vi.mocked(invoke).mockResolvedValue([updatedAction]);

      await useActionsStore.getState().updateAction(updatedAction);

      expect(useActionsStore.getState().actions).toEqual([updatedAction]);
    });

    it("calls invoke with correct command", async () => {
      vi.mocked(invoke).mockResolvedValue([mockAction]);

      await useActionsStore.getState().updateAction(mockAction);

      expect(invoke).toHaveBeenCalledWith("update_custom_action", {
        action: mockAction,
      });
    });

    it("sets error on update failure", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("Update failed"));

      await useActionsStore.getState().updateAction(mockAction);

      expect(useActionsStore.getState().error).toBe("Update failed");
    });
  });

  describe("deleteAction", () => {
    it("removes action after successful delete", async () => {
      useActionsStore.setState({ actions: [mockAction] });
      vi.mocked(invoke).mockResolvedValue([]);

      await useActionsStore.getState().deleteAction("action-1");

      expect(useActionsStore.getState().actions).toEqual([]);
    });

    it("calls invoke with correct command", async () => {
      vi.mocked(invoke).mockResolvedValue([]);

      await useActionsStore.getState().deleteAction("action-1");

      expect(invoke).toHaveBeenCalledWith("delete_custom_action", {
        id: "action-1",
      });
    });

    it("sets error on delete failure", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("Delete failed"));

      await useActionsStore.getState().deleteAction("action-1");

      expect(useActionsStore.getState().error).toBe("Delete failed");
    });
  });

  describe("executeAction", () => {
    it("sets executing state while running", async () => {
      vi.mocked(invoke).mockResolvedValue({ success: true, output: "Hello" });

      const execPromise = useActionsStore
        .getState()
        .executeAction("action-1", "Ubuntu");

      expect(useActionsStore.getState().isExecuting).toBe(true);

      await execPromise;

      expect(useActionsStore.getState().isExecuting).toBe(false);
    });

    it("stores execution result on success", async () => {
      const result = { success: true, output: "Hello" };
      vi.mocked(invoke).mockResolvedValue(result);

      await useActionsStore.getState().executeAction("action-1", "Ubuntu");

      expect(useActionsStore.getState().executionResult).toEqual(result);
    });

    it("returns execution result", async () => {
      const result = { success: true, output: "Hello" };
      vi.mocked(invoke).mockResolvedValue(result);

      const returned = await useActionsStore
        .getState()
        .executeAction("action-1", "Ubuntu");

      expect(returned).toEqual(result);
    });

    it("calls invoke with correct parameters including optional id", async () => {
      vi.mocked(invoke).mockResolvedValue({ success: true, output: "" });

      await useActionsStore
        .getState()
        .executeAction("action-1", "Ubuntu", "guid-123");

      expect(invoke).toHaveBeenCalledWith("execute_custom_action", {
        actionId: "action-1",
        distro: "Ubuntu",
        id: "guid-123",
        password: undefined,
      });
    });

    it("calls invoke with password when provided", async () => {
      vi.mocked(invoke).mockResolvedValue({ success: true, output: "" });

      await useActionsStore
        .getState()
        .executeAction("action-1", "Ubuntu", undefined, "mypassword");

      expect(invoke).toHaveBeenCalledWith("execute_custom_action", {
        actionId: "action-1",
        distro: "Ubuntu",
        id: undefined,
        password: "mypassword",
      });
    });

    it("stores error result on failure", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("Execution failed"));

      const result = await useActionsStore
        .getState()
        .executeAction("action-1", "Ubuntu");

      expect(result).toEqual({
        success: false,
        output: "",
        error: "Execution failed",
      });
      expect(useActionsStore.getState().executionResult).toEqual({
        success: false,
        output: "",
        error: "Execution failed",
      });
    });
  });

  describe("exportActions", () => {
    it("returns exported JSON", async () => {
      const exportedJson = '{"actions":[]}';
      vi.mocked(invoke).mockResolvedValue(exportedJson);

      const result = await useActionsStore.getState().exportActions();

      expect(result).toBe(exportedJson);
    });

    it("calls invoke with correct command", async () => {
      vi.mocked(invoke).mockResolvedValue("{}");

      await useActionsStore.getState().exportActions();

      expect(invoke).toHaveBeenCalledWith("export_custom_actions");
    });

    it("returns null and sets error on failure", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("Export failed"));

      const result = await useActionsStore.getState().exportActions();

      expect(result).toBeNull();
      expect(useActionsStore.getState().error).toBe("Export failed");
    });
  });

  describe("importActions", () => {
    it("updates actions after successful import", async () => {
      const importedActions = [mockAction];
      vi.mocked(invoke).mockResolvedValue(importedActions);

      await useActionsStore.getState().importActions("{}", false);

      expect(useActionsStore.getState().actions).toEqual(importedActions);
    });

    it("calls invoke with merge flag", async () => {
      vi.mocked(invoke).mockResolvedValue([]);

      await useActionsStore.getState().importActions('{"actions":[]}', true);

      expect(invoke).toHaveBeenCalledWith("import_custom_actions", {
        json: '{"actions":[]}',
        merge: true,
      });
    });

    it("sets error on import failure", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("Import failed"));

      await useActionsStore.getState().importActions("{}", false);

      expect(useActionsStore.getState().error).toBe("Import failed");
    });
  });

  describe("clearExecutionResult", () => {
    it("clears the execution result", () => {
      useActionsStore.setState({
        executionResult: { success: true, output: "test" },
      });

      useActionsStore.getState().clearExecutionResult();

      expect(useActionsStore.getState().executionResult).toBeNull();
    });
  });

  describe("startupActionOutput", () => {
    it("has null startup action output initially", () => {
      const state = useActionsStore.getState();
      expect(state.startupActionOutput).toBeNull();
    });

    it("sets startup action output", () => {
      const output = {
        actionName: "Test Action",
        distro: "Ubuntu",
        output: "Hello World",
        error: undefined,
      };

      useActionsStore.getState().setStartupActionOutput(output);

      expect(useActionsStore.getState().startupActionOutput).toEqual(output);
    });

    it("sets startup action output with error", () => {
      const output = {
        actionName: "Failing Action",
        distro: "Ubuntu",
        output: "",
        error: "Command failed",
      };

      useActionsStore.getState().setStartupActionOutput(output);

      expect(useActionsStore.getState().startupActionOutput).toEqual(output);
    });

    it("clears startup action output", () => {
      useActionsStore.setState({
        startupActionOutput: {
          actionName: "Test",
          distro: "Ubuntu",
          output: "test",
        },
      });

      useActionsStore.getState().clearStartupActionOutput();

      expect(useActionsStore.getState().startupActionOutput).toBeNull();
    });
  });
});
