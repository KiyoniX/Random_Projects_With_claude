// Exercice 02 : l'aiguillage.
// Un « switch » à cas serrés devient, sous -O2, une table de sauts : une liste d'adresses dans laquelle
// le processeur pioche selon la valeur. Les jeux en sont pleins (états, menus, types d'objets).
// Ici huit modes qu'on fait tourner avec A, chacun avec sa formule.
#include <3ds.h>
#include <stdio.h>

static u32 calculer(u32 mode, u32 x)
{
	switch (mode) {
	case 0: return x + 1;
	case 1: return x * 3;
	case 2: return x ^ 0x55AA;
	case 3: return x >> 2;
	case 4: return (x << 5) | (x >> 27);
	case 5: return x * x;
	case 6: return 1000 - x;
	case 7: return x / 7;
	default: return x;
	}
}

static const char *NOMS[8] = { "plus un", "triple", "ou exclusif", "quart", "rotation", "carre", "complement", "septieme" };

int main(int argc, char **argv)
{
	gfxInitDefault();
	consoleInit(GFX_TOP, NULL);
	printf("Exercice 02 : l'aiguillage\nA change de mode, Start quitte.\n");

	u32 mode = 0, x = 0;
	while (aptMainLoop()) {
		hidScanInput();
		u32 appuis = hidKeysDown();
		if (appuis & KEY_START)
			break;
		if (appuis & KEY_A)
			mode = (mode + 1) & 7;
		x = (x + 1) & 0xFFFF;
		printf("\x1b[4;1Hmode %lu (%s) : f(%lu) = %lu       ", (unsigned long)mode, NOMS[mode], (unsigned long)x, (unsigned long)calculer(mode, x));
		gfxFlushBuffers();
		gfxSwapBuffers();
		gspWaitForVBlank();
	}

	gfxExit();
	return 0;
}
