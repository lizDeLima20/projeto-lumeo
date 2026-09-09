export interface ExternalLibrarySource {
  id: string;
  userId: string;
  name: string;
  provider: "ONEDRIVE";
  sourceUrl: string;
  remoteFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  enabled: boolean;
}
