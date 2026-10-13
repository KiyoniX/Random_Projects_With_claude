// Exercice 03 : la sauvegarde.
// Une structure écrite telle quelle sur la carte SD, avec un magic, une version et une somme de contrôle.
// C'est exactement ce qu'on retrouvera dans les fichiers d'un jeu : des champs à des décalages fixes,
// une somme à comprendre pour pouvoir modifier le fichier sans qu'il soit rejeté.
#include <3ds.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#define MAGIC   0x56415344u   /* "DSAV" lu à l'envers en mémoire */
#define VERSION 3
#define CHEMIN  "sdmc:/decompil-3ds-ex03.sav"

typedef struct {
	u32 magic;
	u16 version;
	u8  vies;
	u8  niveau;
	char nom[12];
	u32 score;
	u32 somme;
} Sauvegarde;

static u32 somme_de_controle(const Sauvegarde *s)
{
	const u8 *p = (const u8 *)s;
	u32 somme = 0x1234;
	for (u32 i = 0; i < offsetof(Sauvegarde, somme); i++)
		somme = (somme << 1 | somme >> 31) + p[i];
	return somme;
}

static int ecrire(const Sauvegarde *s)
{
	FILE *f = fopen(CHEMIN, "wb");
	if (!f) return 0;
	size_t n = fwrite(s, sizeof *s, 1, f);
	fclose(f);
	return n == 1;
}

static int lire(Sauvegarde *s)
{
	FILE *f = fopen(CHEMIN, "rb");
	if (!f) return 0;
	size_t n = fread(s, sizeof *s, 1, f);
	fclose(f);
	if (n != 1) return 0;
	if (s->magic != MAGIC) return -1;
	if (s->version != VERSION) return -2;
	if (s->somme != somme_de_controle(s)) return -3;
	return 1;
}

int main(int argc, char **argv)
{
	gfxInitDefault();
	consoleInit(GFX_TOP, NULL);
	printf("Exercice 03 : la sauvegarde\nA sauve, B relit, Start quitte.\n");

	Sauvegarde s;
	memset(&s, 0, sizeof s);
	s.magic = MAGIC;
	s.version = VERSION;
	s.vies = 3;
	s.niveau = 1;
	strncpy(s.nom, "KALOS", sizeof s.nom - 1);
	s.score = 0;

	while (aptMainLoop()) {
		hidScanInput();
		u32 appuis = hidKeysDown();
		if (appuis & KEY_START)
			break;
		if (appuis & KEY_A) {
			s.score += 150;
			s.niveau++;
			s.somme = somme_de_controle(&s);
			printf("\x1b[5;1Hecriture : %s      ", ecrire(&s) ? "ok" : "ratee");
		}
		if (appuis & KEY_B) {
			Sauvegarde lu;
			int r = lire(&lu);
			// %.12s : un fichier trafiqué peut remplir nom sans zéro final ; on ne lit jamais au-delà.
			if (r == 1)
				printf("\x1b[6;1Hlecture : %.12s, niveau %u, score %lu      ", lu.nom, lu.niveau, (unsigned long)lu.score);
			else
				printf("\x1b[6;1Hlecture : refusee (code %d)      ", r);
		}
		gfxFlushBuffers();
		gfxSwapBuffers();
		gspWaitForVBlank();
	}

	gfxExit();
	return 0;
}
