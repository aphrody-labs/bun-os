import { MediaUploadApi } from "@storyteller/api";
import { FilterEngineCategories, MediaFileAnimationType, getFileExtension } from "../../Types";

export const uploadAsset = async ({
  file,
  title,
  engineCategory,
  animationType,
  durationMillis,
}: {
  file: File;
  title: string;
  engineCategory: FilterEngineCategories;
  animationType?: MediaFileAnimationType;
  // Required by the backend when engineCategory is "animation".
  durationMillis?: number;
}) => {
  const mediaUploadApi = new MediaUploadApi();
  const fileExtension = getFileExtension(file);

  switch (fileExtension) {
    case ".spz":
      return mediaUploadApi.UploadSpzFile({
        file,
        fileName: file.name,
        uuid: crypto.randomUUID(),
        maybe_title: title,
      });
    case ".zip":
      return mediaUploadApi.UploadPmx({
        file,
        fileName: file.name,
        engine_category: engineCategory,
        maybe_title: title,
        maybe_animation_type: animationType,
        uuid: crypto.randomUUID(),
      });
    default:
      return mediaUploadApi.UploadNewEngineAsset({
        file,
        fileName: file.name,
        engine_category: engineCategory,
        maybe_title: title,
        maybe_animation_type: animationType,
        maybe_duration_millis: durationMillis,
        uuid: crypto.randomUUID(),
      });
  }
};
