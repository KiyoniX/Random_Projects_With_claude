// Exercice 01 : la boucle principale.
// Le programme le plus simple qui tourne sur la console : un écran texte, un compteur, Start pour sortir.
// Tout homebrew et tout jeu ont cette forme ; apprendre à la reconnaître est le premier pas.
#include <3ds.h>
#include <stdio.h>

int main(int argc, char **argv)
{
	gfxInitDefault();
	consoleInit(GFX_TOP, NULL);
	printf("Exercice 01 : la boucle\n");
	printf("Start pour quitter.\n");

	u32 tours = 0;
	while (aptMainLoop()) {
		hidScanInput();
		u32 appuis = hidKeysDown();
		if (appuis & KEY_START)
			break;
		tours++;
		if ((tours & 63) == 0)
			printf("\x1b[4;1Htours : %lu   ", (unsigned long)tours);
		gfxFlushBuffers();
		gfxSwapBuffers();
		gspWaitForVBlank();
	}

	gfxExit();
	return 0;
}
