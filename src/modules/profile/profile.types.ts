export type ProfileDto = {
  id: number;
  locale: "uk" | "en";
  sex: "male" | "female";
  dateOfBirth: string;
  heightCm: number;
  targetWeightKg: number | null;
  targetDate: string | null;
  autoAdvanceExercises: boolean;
  createdAt: string;
  updatedAt: string;
};
