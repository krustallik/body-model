export type ProfileDto = {
  id: number;
  sex: "male" | "female";
  dateOfBirth: string;
  heightCm: number;
  targetWeightKg: number | null;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
};
