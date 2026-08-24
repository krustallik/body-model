ALTER TABLE "Profile"
ADD COLUMN "locale" VARCHAR(2) NOT NULL DEFAULT 'uk';

ALTER TABLE "Profile"
ADD CONSTRAINT "Profile_locale_check" CHECK ("locale" IN ('uk', 'en'));
