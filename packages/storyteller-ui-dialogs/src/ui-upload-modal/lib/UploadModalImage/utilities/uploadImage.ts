import { MediaUploadApi } from "@storyteller/api";
import { UploaderState, UploaderStates, getFileName } from "../../Types";

export const uploadImage = async ({
  title,
  assetFile,
  progressCallback,
}: {
  title: string;
  assetFile: File;
  progressCallback: (newState: UploaderState) => void;
}) => {
  const mediaUploadApi = new MediaUploadApi();

  progressCallback({ status: UploaderStates.uploadingAsset });

  const assetResponse = await mediaUploadApi.UploadImage({
    blob: assetFile,
    fileName: getFileName(assetFile),
    uuid: crypto.randomUUID(),
    maybe_title: title,
  });

  if (assetResponse == undefined) {
    progressCallback({
      status: UploaderStates.assetError,
      errorMessage: "Could not upload image plane!",
    });
    return;
  }

  if (!assetResponse.success || !assetResponse.data) {
    progressCallback({
      status: UploaderStates.assetError,
      errorMessage: assetResponse.errorMessage,
    });
    return;
  }

  progressCallback({
    status: UploaderStates.success,
    data: assetResponse.data,
  });
};
