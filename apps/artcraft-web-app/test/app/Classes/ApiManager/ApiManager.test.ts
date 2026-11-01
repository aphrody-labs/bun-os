import { ApiManager } from "~/Classes/ApiManager/ApiManager";
import EnvironmentVariables from "~/Classes/EnvironmentVariables";

describe("ApiManager", () => {
  let apiManager: ApiManager;
  beforeAll(() => {
    EnvironmentVariables.initialize({
      BASE_API: "http://localhost:3000",
      GOOGLE_API: "https://google.example",
      FUNNEL_API: "https://funnel.example",
      CDN_API: "https://cdn.example",
      GRAVATAR_API: "https://gravatar.example",
      UPLOAD_API_VIDEO: "https://upload.example",
    });
  });
  beforeEach(() => {
    apiManager = new ApiManager();
  });
  it("should be defined", () => {
    expect(apiManager).toBeDefined();
  });
  it("should populate the environment variables", () => {
    expect(apiManager.ApiTargets).toEqual({
      CdnApi: "https://cdn.example",
      FunnelApi: "https://funnel.example",
      GoggleApi: "https://google.example",
      GravatarApi: "https://gravatar.example",
      uploadApi: "https://upload.example",
    });
  });
});
