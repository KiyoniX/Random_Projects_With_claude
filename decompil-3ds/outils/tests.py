"""Lance les tests de tous les lecteurs de formats et du repérage des graines de Ghidra : python outils/tests.py"""
import cro_loader
import elfer
import firm
import garc
import ghidra_direct
import ghidra_raw
import inspecter
import lz11
import nand
import svc_check
import texte

if __name__ == '__main__':
    lz11.test()
    garc.test()
    inspecter.test()
    texte.test()
    elfer.test()
    ghidra_direct.test()
    ghidra_raw.test()
    firm.test()
    svc_check.test()
    cro_loader.test()
    nand.test()
    # Le banc d'essai (banc/tests.py) : programme ARM fabriqué, et le vrai jeu jusqu'au palier P1 s'il est là.
    import importlib.util
    import os
    spec = importlib.util.spec_from_file_location('banc_tests', os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'banc', 'tests.py'))
    banc_tests = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(banc_tests)
    banc_tests.test()
    # La recompilation (recomp/tests.py) : instructions fabriquées, natif comparé à unicorn s'il y a clang.
    spec = importlib.util.spec_from_file_location('recomp_tests', os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'recomp', 'tests.py'))
    recomp_tests = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(recomp_tests)
    recomp_tests.test()
    # Le moteur de mods (mods/tests.py) : formats sur données fabriquées, puis aller-retour sur le dump s'il est là.
    spec = importlib.util.spec_from_file_location('mods_tests', os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'mods', 'tests.py'))
    mods_tests = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mods_tests)
    mods_tests.test()
