"""Lance les tests de tous les lecteurs de formats : python outils/tests.py"""
import elfer
import garc
import inspecter
import lz11
import texte

if __name__ == '__main__':
    lz11.test()
    garc.test()
    inspecter.test()
    texte.test()
    elfer.test()
